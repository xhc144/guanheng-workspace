(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const form = $('#proposal-form'), status = $('#form-status'), orders = $('#orders'), button = $('#purchase');
  let ready = false, generationReady = false;
  let availability = '服务暂不可用，当前不会收款。';
  let generationMessage = '方案生成尚未配置。', paymentMessage = '微信支付保持关闭，当前不会收款。';
  let lastUser = null, lastOrders = '', requestKey = null, submittedProfile = null, submitting = false, refreshing = false;
  const qrImages = new Map(), draftKey = 'gh-proposal-draft-v1';

  async function api(route, data) {
    let response, value;
    try {
      response = await fetch('/proposal-api' + route, {
        method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
        headers: data === undefined ? {} : {'Content-Type': 'application/json'},
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      value = await response.json();
    } catch { throw new Error('暂时无法连接方案服务，请稍后重试；资料仍保留在当前页面。'); }
    if (!response.ok) throw new Error(value.message || '操作未完成，请重试。');
    return value;
  }

  function profile() { return Object.fromEntries(new FormData(form)); }
  function save() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(profile()));
      status.textContent = '草稿已保存在这台设备的浏览器中。';
    } catch { status.textContent = '浏览器无法保存草稿，请保留当前页面。'; }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || '{}');
    for (const [key, value] of Object.entries(saved)) {
      const element = form.elements.namedItem(key);
      if (element && typeof value === 'string') element.value = value;
    }
  } catch { /* An unreadable local draft never prevents service availability checks. */ }
  $('#save-draft').onclick = save;
  $('#login').onclick = () => {
    const account = $('.gh-account-button');
    if (lastUser) status.textContent = '当前登录邮箱：' + lastUser;
    else if (account) account.click();
    else status.textContent = '登录组件未加载，请刷新页面。';
  };
  form.addEventListener('input', () => { requestKey = null; submittedProfile = null; });

  function label(state) {
    return ({awaiting_payment: '等待微信支付', queued: '已付款，等待生成', generating: '正在生成', completed: '已完成', failed: '生成未完成'})[state] || state;
  }
  function action(parent, text, callback) {
    const control = document.createElement('button');
    control.type = 'button'; control.textContent = text;
    control.onclick = async () => {
      control.disabled = true;
      try { await callback(); }
      catch (error) { status.textContent = error.message; }
      finally { control.disabled = false; }
    };
    parent.append(control);
  }
  function note(parent, text) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text; parent.append(paragraph);
  }
  function qr(parent, source) {
    let image = parent.querySelector('img');
    if (!image) {
      image = document.createElement('img');
      image.alt = '微信支付99元二维码'; parent.append(image);
    }
    image.src = source;
  }
  async function pay(id, element) {
    if (!ready) throw new Error(paymentMessage);
    const value = await api('/orders/' + id + '/payment', {});
    if (value.qr) {
      qrImages.set(id, value.qr); qr(element, value.qr);
      status.textContent = '请用另一台设备上的微信扫一扫。支付后自动开始生成；如状态未更新，可点击“检查支付结果”。';
    }
    await refresh();
  }

  function render(list) {
    orders.replaceChildren();
    for (const order of list) {
      const element = document.createElement('article');
      element.className = 'proposal-order';
      const heading = document.createElement('h3');
      heading.textContent = order.company + ' · ' + label(order.state); element.append(heading);
      note(element, '¥99 · ' + new Date(order.createdAt).toLocaleString('zh-CN') + ' · 订单 ' + order.id);
      if (order.message) note(element, order.message);
      if (order.state === 'awaiting_payment') {
        if (ready) {
          action(element, '显示微信支付码', () => pay(order.id, element));
          action(element, '检查支付结果', () => pay(order.id, element));
          if (qrImages.has(order.id)) qr(element, qrImages.get(order.id));
        } else note(element, paymentMessage);
      } else qrImages.delete(order.id);
      if (order.state === 'failed') {
        if (!order.paid) note(element, '订单未确认付款，无法重试。');
        else if (generationReady) action(element, '免费重试', async () => { await api('/orders/' + order.id + '/retry', {}); await refresh(); });
        else note(element, generationMessage);
      }
      if (['queued', 'generating'].includes(order.state) && !generationReady) note(element, generationMessage);
      if (order.downloadReady) {
        for (const extension of ['pptx', 'pdf']) {
          const link = document.createElement('a');
          link.textContent = '下载 ' + extension.toUpperCase();
          link.href = '/proposal-api/orders/' + order.id + '/' + extension;
          element.append(link);
        }
      }
      orders.append(element);
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const response = await fetch('/portal-api/auth/me', {credentials: 'same-origin'}), me = await response.json();
      const user = me.user?.email || null;
      if (user !== lastUser) { lastUser = user; lastOrders = ''; qrImages.clear(); orders.replaceChildren(); }
      $('#login').textContent = user ? '已登录' : '客户登录';
      button.disabled = !ready || submitting;
      $('#orders-message').textContent = user ? '订单及文件仅对当前登录邮箱开放。' : '登录后可查看订单和下载文件。';
      if (!user) return;
      const value = await api('/orders'), signature = JSON.stringify([ready, generationReady, value.orders]);
      if (signature !== lastOrders) { render(value.orders); lastOrders = signature; }
    } catch { $('#orders-message').textContent = '暂时无法读取订单，稍后自动重试。'; }
    finally { refreshing = false; }
  }

  async function identity(signature) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lastUser + '|' + signature));
    const key = 'gh-proposal-request-' + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    try {
      let value = sessionStorage.getItem(key);
      if (!value) { value = crypto.randomUUID().replaceAll('-', ''); sessionStorage.setItem(key, value); }
      return value;
    } catch { return crypto.randomUUID().replaceAll('-', ''); }
  }

  form.onsubmit = async event => {
    event.preventDefault();
    if (submitting) return;
    if (!ready) { status.textContent = availability; return; }
    if (!form.reportValidity()) return;
    if (!lastUser) { $('#login').click(); status.textContent = '请先登录，填写的资料会保留。'; return; }
    submitting = true; button.disabled = true;
    try {
      const data = profile(), signature = JSON.stringify(data);
      if (submittedProfile !== signature) { submittedProfile = signature; requestKey = await identity(signature); }
      const value = await api('/orders', {profile: data, idempotencyKey: requestKey});
      status.textContent = '订单已创建，请在下方扫码支付。';
      await refresh();
      const element = [...orders.children].find(child => child.textContent.includes(value.order.id));
      if (element) { element.scrollIntoView({behavior: 'smooth', block: 'center'}); await pay(value.order.id, element); }
    } catch (error) { status.textContent = error.message; }
    finally { submitting = false; button.disabled = !ready; }
  };

  api('/config').then(config => {
    generationReady = config.generationReady === true;
    ready = config.paymentReady === true && generationReady;
    generationMessage = config.generationMessage || generationMessage;
    paymentMessage = config.paymentMessage || paymentMessage;
    availability = ready ? '填写需求 → 微信扫码支付 → 自动生成 → 下载方案' :
      (generationReady ? '' : generationMessage + ' ') + paymentMessage + ' 可保存本机草稿并查看已有订单。';
    $('#availability').textContent = availability;
    button.textContent = ready ? '微信支付 ¥99 并生成' : '下单与支付暂未开放';
    button.disabled = !ready;
    refresh();
  }).catch(() => { $('#availability').textContent = availability; });
  refresh();
  setInterval(refresh, 5000);
})();
