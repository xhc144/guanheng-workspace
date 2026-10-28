"""Member grants and ownership changes must not turn project access into authority.

Each case uses a fresh synthetic database and real bearer authentication. Reuse
the archive fixture without depending on core-flow collection or test ordering.
"""
import pytest

from .test_archive_regressions import isolated, models, scoped_users, upload_rows


@pytest.fixture
def members(models, scoped_users):
    client, headers, factory, ids = scoped_users
    with factory() as db:
        viewer = db.query(models.Role).filter_by(code="viewer").one()
        for label, active in (("candidate", True), ("disabled", False)):
            target = models.User(username=f"synthetic-{label}", name=f"合成{label}",
                                 password_hash="unused-synthetic-hash", is_active=active,
                                 roles=[viewer])
            db.add(target); db.flush()
            ids[f"{label}_id"] = target.id
        db.commit()
    return client, headers, factory, ids


def state(models, factory):
    """Include existing values, so a failed request cannot silently edit a row."""
    with factory() as db:
        return {
            "members": [(m.id, m.project_id, m.user_id, m.role_in_project)
                        for m in db.query(models.ProjectMember).order_by(models.ProjectMember.id)],
            "projects": [(p.id, p.owner_id, p.name, p.version)
                         for p in db.query(models.Project).order_by(models.Project.id)],
            "risks": [(r.id, r.title, r.status) for r in db.query(models.Risk)],
            "roles": [(u.id, sorted(r.code for r in u.roles)) for u in db.query(models.User)],
            "counts": {model.__tablename__: db.query(model).count() for model in (
                models.AuditLog, models.Activity, models.Notification, models.Customer,
                models.Contract, models.Invoice, models.Payment, models.PaymentPlan,
                models.PaymentAllocation, models.RiskFollowup)},
        }


def assert_protected_routes_denied(client, actor, ids):
    pid = ids["protected_id"]
    responses = [
        client.get(f"/api/v1/projects/{pid}/finance", headers=actor),
        client.get("/api/v1/contracts", headers=actor, params={"project_id": pid}),
        client.post("/api/v1/contracts", headers=actor, json={
            "code": "DENIED-CONTRACT", "project_id": pid, "amount": 1}),
        client.patch(f"/api/v1/risks/{ids['risk_id']}", headers=actor,
                     json={"title": "不应修改"}),
        upload_rows(client, actor, [["SCOPE-OWNER", "不应导入", "不应创建客户", 10, 1, 9]]),
    ]
    assert [r.status_code for r in responses] == [403] * len(responses)


def test_nonmember_cannot_self_enroll_and_unlock_protected_routes(models, members):
    client, headers, factory, ids = members
    before = state(models, factory)
    assert_protected_routes_denied(client, headers["outsider"], ids)
    response = client.post(f"/api/v1/projects/{ids['protected_id']}/members",
                           headers=headers["outsider"], json={"user_id": ids["outsider_id"],
                           "project_id": ids["other_id"], "role": "负责人"})
    assert response.status_code == 403, response.text
    assert_protected_routes_denied(client, headers["outsider"], ids)
    assert state(models, factory) == before


@pytest.mark.parametrize("actor_kind", ["outside_writer", "viewer_member", "writer_member",
                                        "finance_member", "finance_owner", "viewer_owner",
                                        "forged_owner_label"])
@pytest.mark.parametrize("target", ["self", "other"])
def test_project_access_does_not_allow_member_grants(models, members, actor_kind, target):
    client, headers, factory, ids = members
    actor = "owner" if actor_kind.endswith("_owner") else "outsider"
    actor_id = ids[f"{actor}_id"]
    with factory() as db:
        if actor_kind.startswith("viewer_") or actor_kind.startswith("finance_"):
            code = actor_kind.split("_")[0]
            db.get(models.User, actor_id).roles = [db.query(models.Role).filter_by(code=code).one()]
        if actor_kind.endswith("_member") or actor_kind == "forged_owner_label":
            db.add(models.ProjectMember(project_id=ids["protected_id"], user_id=actor_id,
                role_in_project="负责人" if actor_kind == "forged_owner_label" else "成员"))
        db.commit()
    before = state(models, factory)
    response = client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=headers[actor],
                           json={"user_id": actor_id if target == "self" else ids["candidate_id"],
                                 "role": "负责人"})
    assert response.status_code == 403, response.text
    assert state(models, factory) == before


@pytest.mark.parametrize("actor", ["owner", "admin", "pm"])
def test_authorized_project_managers_can_add_members(models, members, actor):
    client, headers, factory, ids = members
    selected = headers["outsider"] if actor == "pm" else headers[actor]
    if actor == "pm":
        with factory() as db:
            db.get(models.User, ids["outsider_id"]).roles = [db.query(models.Role).filter_by(code="pm").one()]
            db.commit()
    before = state(models, factory)
    response = client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=selected,
                           json={"user_id": ids["candidate_id"], "role": "协作人",
                                 "project_id": ids["other_id"]})
    assert response.status_code == 201, response.text
    with factory() as db:
        member = db.get(models.ProjectMember, response.json()["id"])
        assert (member.project_id, member.user_id, member.role_in_project) == (
            ids["protected_id"], ids["candidate_id"], "协作人")
        assert db.query(models.AuditLog).count() == before["counts"]["audit_logs"] + 1
        assert db.query(models.Activity).count() == before["counts"]["activities"] + 1
        assert [r.code for r in db.get(models.User, ids["candidate_id"]).roles] == ["viewer"]
    # Membership management does not invent finance permissions for the PM.
    if actor == "pm":
        assert client.post("/api/v1/contracts", headers=selected, json={
            "code": "PM-NO-FINANCE", "project_id": ids["protected_id"], "amount": 1}).status_code == 403
    after = state(models, factory)
    duplicate = client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=selected,
                            json={"user_id": ids["candidate_id"], "role": "负责人"})
    assert duplicate.status_code == 409
    assert state(models, factory) == after


@pytest.mark.parametrize("actor", ["owner", "admin"])
@pytest.mark.parametrize("target,expected", [("disabled", 422), ("missing", 404)])
def test_authorized_add_rejects_unavailable_users_without_writes(models, members, actor, target, expected):
    client, headers, factory, ids = members
    before = state(models, factory)
    response = client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=headers[actor],
                           json={"user_id": ids["disabled_id"] if target == "disabled" else 999999})
    assert response.status_code == expected, response.text
    assert state(models, factory) == before


@pytest.mark.parametrize("actor", ["owner", "admin"])
def test_actor_deactivation_is_rechecked_with_existing_token(models, members, actor):
    client, headers, factory, ids = members
    with factory() as db:
        user = (db.get(models.User, ids["owner_id"]) if actor == "owner" else
                db.query(models.User).filter_by(username="admin").one())
        user.is_active = False
        db.commit()
    before = state(models, factory)
    response = client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=headers[actor],
                           json={"user_id": ids["candidate_id"]})
    assert response.status_code == 401, response.text
    assert state(models, factory) == before


def test_missing_project_has_no_member_or_audit_side_effects(models, members):
    client, headers, factory, ids = members
    before = state(models, factory)
    response = client.post("/api/v1/projects/999999/members", headers=headers["admin"],
                           json={"user_id": ids["candidate_id"]})
    assert response.status_code == 404
    assert state(models, factory) == before


def test_member_cannot_take_ownership_to_authorize_an_invitation(models, members):
    client, headers, factory, ids = members
    with factory() as db:
        db.add(models.ProjectMember(project_id=ids["protected_id"], user_id=ids["outsider_id"]))
        db.commit()
    before = state(models, factory)
    response = client.patch(f"/api/v1/projects/{ids['protected_id']}", headers=headers["outsider"],
                            json={"owner_id": ids["outsider_id"], "name": "不应改名"})
    assert response.status_code == 403, response.text
    response = client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=headers["outsider"],
                           json={"user_id": ids["candidate_id"]})
    assert response.status_code == 403, response.text
    assert state(models, factory) == before


def test_current_ownership_is_rechecked_with_existing_token(models, members):
    client, headers, factory, ids = members
    with factory() as db:
        # A former owner remains a member but loses authority to invite.
        db.add(models.ProjectMember(project_id=ids["protected_id"], user_id=ids["owner_id"]))
        db.get(models.Project, ids["protected_id"]).owner_id = ids["candidate_id"]
        db.commit()
    before = state(models, factory)
    response = client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=headers["owner"],
                           json={"user_id": ids["outsider_id"]})
    assert response.status_code == 403, response.text
    assert state(models, factory) == before


@pytest.mark.parametrize("actor", ["owner", "admin", "pm"])
def test_authorized_owner_transfer_still_works(models, members, actor):
    client, headers, factory, ids = members
    selected = headers["outsider"] if actor == "pm" else headers[actor]
    if actor == "pm":
        with factory() as db:
            db.get(models.User, ids["outsider_id"]).roles = [db.query(models.Role).filter_by(code="pm").one()]
            db.commit()
    response = client.patch(f"/api/v1/projects/{ids['protected_id']}", headers=selected,
                            json={"owner_id": ids["candidate_id"]})
    assert response.status_code == 200, response.text
    with factory() as db:
        assert db.get(models.Project, ids["protected_id"]).owner_id == ids["candidate_id"]


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_nonexistent_member_edit_and_remove_apis_stay_unavailable(models, members, method):
    client, headers, factory, ids = members
    with factory() as db:
        member = models.ProjectMember(project_id=ids["protected_id"], user_id=ids["candidate_id"])
        db.add(member); db.commit()
        member_id = member.id
    before = state(models, factory)
    base = f"/api/v1/projects/{ids['protected_id']}/members"
    assert client.request(method, base, headers=headers["outsider"],
                          json={"user_id": ids["candidate_id"], "role": "负责人"}).status_code == 405
    assert client.request(method, f"{base}/{member_id}", headers=headers["outsider"],
                          json={"role": "负责人"}).status_code == 404
    assert state(models, factory) == before


def test_member_audit_failure_rolls_back_grant(models, members, monkeypatch):
    from app.routers import projects

    client, headers, factory, ids = members
    before = state(models, factory)
    original_audit = projects.audit

    def fail_audit(db, *args, **kwargs):
        original_audit(db, *args, **kwargs)
        db.flush()  # The grant and audit have reached the transaction before failure.
        raise RuntimeError("synthetic membership audit failure")

    monkeypatch.setattr(projects, "audit", fail_audit)
    with pytest.raises(RuntimeError, match="synthetic membership audit failure"):
        client.post(f"/api/v1/projects/{ids['protected_id']}/members", headers=headers["owner"],
                    json={"user_id": ids["candidate_id"]})
    assert state(models, factory) == before
