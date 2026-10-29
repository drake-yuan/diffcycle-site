/* DiffCycle 官网 v3 · 交互脚本
   依赖：无。全部为原生 API，保证零构建即可运行。 */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. 滚动渐入 ---------- */
  var revealTargets = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if (revealTargets.length) {
    if (reduced || !('IntersectionObserver' in window)) {
      revealTargets.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
      revealTargets.forEach(function (el) { io.observe(el); });

      /* 兜底：滚动时按视口位置直接判定，避免快速滚动 / 锚点跳转导致区块漏显 */
      var ticking = false;
      function sweepReveal() {
        var vh = window.innerHeight;
        revealTargets.forEach(function (el) {
          if (el.classList.contains('is-in')) return;
          var r = el.getBoundingClientRect();
          if (r.top < vh * 0.94 && r.bottom > -40) el.classList.add('is-in');
        });
        ticking = false;
      }
      function onRevealScroll() {
        if (!ticking) { ticking = true; window.requestAnimationFrame(sweepReveal); }
      }
      window.addEventListener('scroll', onRevealScroll, { passive: true });
      window.addEventListener('resize', onRevealScroll, { passive: true });
      sweepReveal();
    }
  }

  /* ---------- 2. 鼠标跟随高光 ---------- */
  var spot = document.getElementById('bgSpot');
  if (spot && !reduced) {
    var mx = 70, my = 12;
    window.addEventListener('pointermove', function (e) {
      mx = (e.clientX / window.innerWidth) * 100;
      my = (e.clientY / window.innerHeight) * 100;
      spot.style.setProperty('--mx', mx.toFixed(2) + '%');
      spot.style.setProperty('--my', my.toFixed(2) + '%');
    }, { passive: true });
  }

  /* ---------- 3. 导航：滚动进度 + 吸顶描边 + 移动端菜单 ---------- */
  var nav = document.querySelector('.nav');
  var progress = document.getElementById('scrollProgress');
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');

  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (progress) progress.style.width = (ratio * 100).toFixed(2) + '%';
    if (nav) nav.classList.toggle('is-stuck', window.scrollY > 12);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? '收起导航菜单' : '展开导航菜单');
    });
    navLinks.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        navLinks.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- 4. 能力卡片：鼠标位置用于局部高光 ---------- */
  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--cx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      card.style.setProperty('--cy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  });

  /* ---------- 5. 效果对照：Tab 切换 ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.showcase-tabs .tab'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.sc-panel'));
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var view = tab.getAttribute('data-view');
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-view') === view);
      });
    });
  });

  /* ---------- 6. Diff 指标演示循环 ---------- */
  var diffPct = document.getElementById('diffPct');
  var diffBar = document.getElementById('diffBar');
  if (diffPct && diffBar && !reduced) {
    var frames = [{ pct: 15.48, wait: 600000 }];
    var idx = 0;
    function tick() {
      var f = frames[idx % frames.length];
      diffPct.textContent = f.pct.toFixed(1) + '%';
      diffBar.style.width = Math.max(f.pct, 0.6) + '%';
      idx++;
      window.setTimeout(tick, f.wait);
    }
    window.setTimeout(tick, 2600);
  }

  /* ---------- 7. 锚点平滑滚动（兼容不支持 scroll-behavior 的环境） ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', id);
    });
  });

  /* ---------- 8. 「免费开始」：早鸟登记（三级投递：本地端点 → 静态表单 → mailto） ---------- */
    var leadForm = document.getElementById('leadForm');
    var leadStatus = document.getElementById('leadStatus');
    if (leadForm && leadStatus) {
      leadForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = leadForm.querySelector('input[type="email"]');
        var email = input ? input.value.trim() : '';
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          leadStatus.textContent = '请填写有效邮箱';
          leadStatus.classList.add('is-error');
          return;
        }
        var hp = leadForm.querySelector('input[name="bot-field"]');
        if (hp && hp.value) {
          leadStatus.textContent = '已登记：' + email + '，开通方式会发到你的邮箱';
          leadForm.reset();
          return;
        }
        if (window.location.protocol === 'file:') {
          leadStatus.textContent = '请用 node web/serve.mjs 打开本站在提交登记';
          leadStatus.classList.add('is-error');
          return;
        }
        var btn = leadForm.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        leadStatus.classList.remove('is-error');
        leadStatus.textContent = '提交中…';
        var formName = leadForm.getAttribute('name') || 'lead';
        var localReject = '';
        fetch('/api/early-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, source: 'web-cta' })
        }).then(function (r) {
          if (!r.ok) throw new Error('no-local-endpoint');
          return r.json();
        }).then(function (d) {
          if (d && d.ok === false) {
            localReject = d.error || '提交失败';
            throw new Error('local-reject');
          }
          return true;
        }).catch(function (err) {
          if (localReject) throw err;
          var body = new URLSearchParams();
          body.append('form-name', formName);
          body.append('email', email);
          body.append('source', 'web-cta');
          return fetch('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
          }).then(function (r) {
            if (!r.ok) return false;
            return r.text().then(function (t) {
              return t.indexOf('<title>DiffCycle') === -1;
            }).catch(function () { return false; });
          }).catch(function () { return false; });
        }).then(function (ok) {
          if (!ok) throw new Error('no-static-form');
          leadStatus.textContent = '已登记：' + email + '，开通方式会发到你的邮箱';
          leadForm.reset();
        }).catch(function (err) {
          leadStatus.classList.add('is-error');
          if (localReject) {
            leadStatus.textContent = '登记失败：' + localReject;
            return;
          }
          leadStatus.textContent = '提交未成功，请刷新后重试；若持续失败，请用页面底部的邮箱直接联系我们。';
        });
      });
    }})();
/* ---------- 9. 页脚联系邮箱：运行时从服务端取，代码库与前端 JS 里都不出现 ---------- */
(function () {
  var el = document.getElementById('footContact');
  if (!el) return;
  if (window.location.protocol === 'file:') return;
  fetch('/api/contact', { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.ok && d.email) el.textContent = '联系：' + d.email; })
    .catch(function () { /* 服务端未配置 LEAD_MAIL 时保持空白 */ });
})();