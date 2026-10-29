"""Route-local project scope using the existing roles and membership records."""
from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import require_role
from app.models import Project, ProjectMember, User


def is_project_admin(user: User) -> bool:
    try:
        require_role("enterprise_admin")(user)
        return True
    except HTTPException:
        return False


def visible_project_ids(user: User):
    """Guests cannot enter internal project routes; administrators retain access."""
    require_role("member")(user)
    query = select(Project.id)
    if not is_project_admin(user):
        membership = select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
        query = query.where(or_(Project.manager_id == user.id, Project.id.in_(membership)))
    return query.correlate(None)


def require_project(db: Session, user: User, project_id: str) -> Project:
    project = db.query(Project).filter(
        Project.id == project_id, Project.id.in_(visible_project_ids(user)),
    ).first()
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在或无权访问")
    return project


def scope_project_rows(query, project_column, user: User):
    return query.filter(project_column.in_(visible_project_ids(user)))
