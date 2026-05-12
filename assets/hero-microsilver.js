(function () {
  'use strict';

  var ATTR_ROOT = 'data-hero-microsilver-slider';
  var ATTR_TRACK = 'data-hero-microsilver-track';
  var ATTR_SLIDE = 'data-hero-microsilver-slide';
  var ATTR_DOT = 'data-hero-microsilver-dot';

  var prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function HeroMicrosilverSlider(root) {
    this.root = root;
    this.track = root.querySelector('[' + ATTR_TRACK + ']');
    this.slides = Array.prototype.slice.call(
      root.querySelectorAll('[' + ATTR_SLIDE + ']')
    );
    this.dots = Array.prototype.slice.call(
      root.querySelectorAll('[' + ATTR_DOT + ']')
    );
    this.index = 0;
    this.timer = null;

    this.hovered = false;
    this.focused = false;
    this.hidden = !!document.hidden;

    this.autoplay =
      root.getAttribute('data-autoplay') === 'true' && !prefersReducedMotion;

    var delay = parseInt(root.getAttribute('data-autoplay-delay'), 10);
    this.delay = isFinite(delay) && delay >= 1000 ? delay : 3000;

    if (this.slides.length <= 1) {
      this.autoplay = false;
    }

    this.bindEvents();
    this.goTo(0, false);

    if (this.autoplay && !this.hidden) {
      this.start();
    }
  }

  HeroMicrosilverSlider.prototype.bindEvents = function () {
    var self = this;

    this.dots.forEach(function (dot, i) {
      dot.addEventListener('click', function (event) {
        self.goTo(i, true);
        if (event.detail > 0) {
          dot.blur();
        }
        self.restart();
      });

      dot.addEventListener('keydown', function (event) {
        var key = event.key;
        if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') {
          return;
        }
        event.preventDefault();
        var next = i;
        if (key === 'ArrowRight') next = (i + 1) % self.dots.length;
        if (key === 'ArrowLeft') next = (i - 1 + self.dots.length) % self.dots.length;
        if (key === 'Home') next = 0;
        if (key === 'End') next = self.dots.length - 1;
        self.goTo(next, true);
        self.dots[next].focus();
        self.restart();
      });
    });

    this.root.addEventListener('mouseenter', function () {
      self.hovered = true;
      self.stop();
    });
    this.root.addEventListener('mouseleave', function () {
      self.hovered = false;
      self.maybeStart();
    });

    this.root.addEventListener(
      'touchstart',
      function () {
        self.hovered = true;
        self.stop();
      },
      { passive: true }
    );
    this.root.addEventListener('touchend', function () {
      self.hovered = false;
      self.maybeStart();
    });

    this.root.addEventListener('focusin', function () {
      self.focused = true;
      self.stop();
    });
    this.root.addEventListener('focusout', function () {
      if (!self.root.contains(document.activeElement)) {
        self.focused = false;
        self.maybeStart();
      }
    });

    document.addEventListener('visibilitychange', function () {
      self.hidden = !!document.hidden;
      if (self.hidden) {
        self.stop();
      } else {
        self.maybeStart();
      }
    });
  };

  HeroMicrosilverSlider.prototype.maybeStart = function () {
    if (this.autoplay && !this.hovered && !this.focused && !this.hidden) {
      this.start();
    }
  };

  HeroMicrosilverSlider.prototype.goTo = function (next, animated) {
    if (next < 0 || next >= this.slides.length) return;
    this.index = next;

    if (this.track) {
      if (!animated) {
        var prev = this.track.style.transition;
        this.track.style.transition = 'none';
        this.track.style.setProperty('--hero-ms-active', String(next));
        void this.track.offsetWidth;
        this.track.style.transition = prev || '';
      } else {
        this.track.style.setProperty('--hero-ms-active', String(next));
      }
    }

    this.slides.forEach(function (slide, i) {
      if (i === next) {
        slide.classList.add('is-active');
        slide.removeAttribute('aria-hidden');
      } else {
        slide.classList.remove('is-active');
        slide.setAttribute('aria-hidden', 'true');
      }
    });

    this.dots.forEach(function (dot, i) {
      var active = i === next;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-selected', active ? 'true' : 'false');
      dot.setAttribute('tabindex', active ? '0' : '-1');
    });
  };

  HeroMicrosilverSlider.prototype.next = function () {
    var n = (this.index + 1) % this.slides.length;
    this.goTo(n, true);
  };

  HeroMicrosilverSlider.prototype.start = function () {
    if (!this.autoplay) return;
    this.stop();
    var self = this;
    this.timer = window.setInterval(function () {
      self.next();
    }, this.delay);
  };

  HeroMicrosilverSlider.prototype.stop = function () {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  };

  HeroMicrosilverSlider.prototype.restart = function () {
    this.maybeStart();
  };

  HeroMicrosilverSlider.prototype.destroy = function () {
    this.stop();
  };

  function init(scope) {
    var root = scope || document;
    var sliders = root.querySelectorAll('[' + ATTR_ROOT + ']');
    sliders.forEach(function (el) {
      if (el.heroMicrosilverSlider) return;
      el.heroMicrosilverSlider = new HeroMicrosilverSlider(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init();
    });
  } else {
    init();
  }

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });

  document.addEventListener('shopify:section:unload', function (event) {
    var sliders = event.target.querySelectorAll('[' + ATTR_ROOT + ']');
    sliders.forEach(function (el) {
      if (el.heroMicrosilverSlider) {
        el.heroMicrosilverSlider.destroy();
        el.heroMicrosilverSlider = null;
      }
    });
  });
})();
