/* 关衡软件 · 新版官网  交互脚本 */
(function () {
  'use strict';

  /* 移动端菜单 */
  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
      toggle.classList.toggle('active');
    });
    /* 点击菜单项后收起 */
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle.classList.remove('active');
      });
    });
  }

  /* 当前导航高亮 */
  var path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === path) a.classList.add('active');
  });

  /* 保留原有个人工作台：以一个小入口放在新官网右下角。 */
  if (!document.querySelector('.legacy-workspace-link')) {
    var workspaceLink = document.createElement('a');
    workspaceLink.className = 'legacy-workspace-link';
    workspaceLink.href = '/workspace/';
    workspaceLink.textContent = '原工作台';
    workspaceLink.setAttribute('aria-label', '打开原有云端工作台');
    document.body.appendChild(workspaceLink);
  }
})();

/* 预约演示表单提交（静态演示，实际对接后端/CRM） */
function submitDemo(e) {
  e.preventDefault();
  var name = document.getElementById('f-name').value.trim();
  var tel = document.getElementById('f-tel').value.trim();
  var company = document.getElementById('f-company').value.trim();
  if (!name || !tel || !company) {
    alert('请填写姓名、电话和公司名称');
    return false;
  }
  if (!/^1[3-9]\d{9}$|^0\d{2,3}-?\d{7,8}$/.test(tel)) {
    alert('请填写正确的联系电话');
    return false;
  }
  /* TODO: 对接后端接口 / CRM，这里先做前端演示 */
  alert('提交成功！顾问将在 1 个工作日内与你联系。\n\n姓名：' + name + '\n电话：' + tel + '\n公司：' + company);
  e.target.reset();
  return false;
}

/* 全站图片点击放大：内容图片和背景图统一进入同一画廊，支持 ESC / ← / →。 */
(function initLightbox() {
  'use strict';

  function getBackgroundSource(element) {
    var background = element.style.backgroundImage || window.getComputedStyle(element).backgroundImage || '';
    var match = background.match(/url\((['"]?)(.*?)\1\)/);
    if (!match || !match[2] || match[2] === 'none') return '';
    try {
      return new URL(match[2], document.baseURI).href;
    } catch (error) {
      return match[2];
    }
  }

  var items = [];
  Array.prototype.slice.call(document.querySelectorAll('img')).forEach(function (img) {
    if (!img.src || img.matches('[data-no-lightbox], .site-logo img')) return;
    items.push({
      element: img,
      src: function () { return img.currentSrc || img.src; },
      alt: img.alt || '图片'
    });
  });
  Array.prototype.slice.call(document.querySelectorAll('[style*="background-image"]')).forEach(function (element) {
    if (element.matches('[data-no-lightbox], .lightbox, .site-logo, .site-logo *')) return;
    var source = getBackgroundSource(element);
    if (!source) return;
    var label = element.getAttribute('data-lightbox-alt') || element.getAttribute('aria-label') ||
      (element.classList.contains('page-hero__bg') ? (document.title.replace(/\s*[|｜].*$/, '') + '头图') : '背景图片');
    items.push({ element: element, src: function () { return source; }, alt: label });
  });
  /* 首页首屏使用 CSS 变量承载图片，也纳入放大浏览。 */
  Array.prototype.slice.call(document.querySelectorAll('[style*="--hero-img"]')).forEach(function (element) {
    if (element.matches('[data-no-lightbox], .lightbox, .site-logo, .site-logo *')) return;
    var inlineStyle = element.getAttribute('style') || '';
    var match = inlineStyle.match(/--hero-img\s*:\s*url\((['"]?)(.*?)\1\)/);
    var source = element.getAttribute('data-lightbox-src') || (match && match[2]);
    if (!source) return;
    try { source = new URL(source, document.baseURI).href; } catch (error) {}
    items.push({
      element: element,
      src: function () { return source; },
      alt: element.getAttribute('data-lightbox-alt') || '首页首屏图片'
    });
  });  if (!items.length) return;

  items.forEach(function (item) {
    var element = item.element;
    element.setAttribute('data-lightbox', 'true');
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', '点击放大查看：' + item.alt);
  });

  var root = document.createElement('div');
  root.className = 'lightbox';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<div class="lightbox__backdrop" data-lightbox-close></div>' +
    '<div class="lightbox__dialog" role="dialog" aria-modal="true" aria-label="图片预览">' +
    '<button class="lightbox__close" type="button" aria-label="关闭图片预览" data-lightbox-close>×</button>' +
    '<button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="上一张" data-lightbox-prev>‹</button>' +
    '<figure class="lightbox__figure"><img class="lightbox__image" alt=""><figcaption class="lightbox__caption"></figcaption></figure>' +
    '<button class="lightbox__nav lightbox__nav--next" type="button" aria-label="下一张" data-lightbox-next>›</button>' +
    '<div class="lightbox__count" aria-live="polite"></div></div>';
  document.body.appendChild(root);

  var preview = root.querySelector('.lightbox__image');
  var caption = root.querySelector('.lightbox__caption');
  var count = root.querySelector('.lightbox__count');
  var current = 0;
  var previousFocus = null;

  function show(index) {
    current = (index + items.length) % items.length;
    var source = items[current];
    preview.src = typeof source.src === 'function' ? source.src() : source.src;
    preview.alt = source.alt || '图片预览';
    caption.textContent = source.alt || '';
    count.textContent = (current + 1) + ' / ' + items.length;
  }

  function open(index) {
    previousFocus = document.activeElement;
    show(index);
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-lightbox-open');
    root.querySelector('.lightbox__close').focus();
  }

  function close() {
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-lightbox-open');
    preview.src = '';
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  items.forEach(function (item, index) {
    var element = item.element;
    element.addEventListener('click', function (event) {
      /* 案例卡片整块是链接：图片点击优先预览，但不影响其它文字链接。 */
      if (element.closest('a')) {
        event.preventDefault();
        event.stopPropagation();
      }
      open(index);
    });
    element.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        open(index);
      }
    });
  });

  root.querySelectorAll('[data-lightbox-close]').forEach(function (element) {
    element.addEventListener('click', close);
  });
  root.querySelector('[data-lightbox-prev]').addEventListener('click', function () { show(current - 1); });
  root.querySelector('[data-lightbox-next]').addEventListener('click', function () { show(current + 1); });
  document.addEventListener('keydown', function (event) {
    if (!root.classList.contains('is-open')) return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });
})();




