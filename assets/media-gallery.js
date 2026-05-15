if (!customElements.get('media-gallery')) {
  customElements.define(
    'media-gallery',
    class MediaGallery extends HTMLElement {
      constructor() {
        super();
        this.mql = window.matchMedia('(min-width: 750px)');
        this.cacheGalleryElements();
      }

      cacheGalleryElements() {
        this.elements = {
          liveRegion: this.querySelector('[id^="GalleryStatus"]'),
          viewer: this.querySelector('[id^="GalleryViewer"]'),
          thumbnails: this.querySelector('[id^="GalleryThumbnails"]'),
        };
      }

      connectedCallback() {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.cacheGalleryElements();
            this.setupGalleryChrome();
            this.initGalleryPaginationDots();
          });
        });
      }

      setupGalleryChrome() {
        if (this.__galleryChromeBound) return;
        this.cacheGalleryElements();
        if (!this.elements.viewer) {
          if ((this.__galleryChromeAttempts = (this.__galleryChromeAttempts || 0) + 1) < 12) {
            window.setTimeout(() => this.setupGalleryChrome(), 100);
          }
          return;
        }

        if (this.elements.thumbnails) {
          this.elements.viewer.addEventListener('slideChanged', debounce(this.onSlideChanged.bind(this), 500));
          this.elements.thumbnails.querySelectorAll('[data-target]').forEach((mediaToSwitch) => {
            mediaToSwitch
              .querySelector('button')
              .addEventListener('click', this.setActiveMedia.bind(this, mediaToSwitch.dataset.target, false));
          });
          if (this.dataset.desktopLayout?.includes('thumbnail') && this.mql.matches) {
            this.removeListSemantic();
          }
        }

        this.__galleryChromeBound = true;
      }

      onSlideChanged(event) {
        const thumbnail = this.elements.thumbnails.querySelector(
          `[data-target="${event.detail.currentElement.dataset.mediaId}"]`
        );
        this.setActiveThumbnail(thumbnail);
      }

      setActiveMedia(mediaId, prepend) {
        if (!this.elements?.viewer) this.cacheGalleryElements();
        if (!this.elements?.viewer) return;

        const activeMedia =
          this.elements.viewer.querySelector(`[data-media-id="${mediaId}"]`) ||
          this.elements.viewer.querySelector('[data-media-id]');
        if (!activeMedia) {
          return;
        }
        this.elements.viewer.querySelectorAll('[data-media-id]').forEach((element) => {
          element.classList.remove('is-active');
        });
        activeMedia?.classList?.add('is-active');

        if (prepend) {
          activeMedia.parentElement.firstChild !== activeMedia && activeMedia.parentElement.prepend(activeMedia);

          if (this.elements.thumbnails) {
            const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
            activeThumbnail.parentElement.firstChild !== activeThumbnail && activeThumbnail.parentElement.prepend(activeThumbnail);
          }

          if (this.elements.viewer.slider) this.elements.viewer.resetPages();
        }

        this.preventStickyHeader();
        window.setTimeout(() => {
          if (!this.mql.matches || this.elements.thumbnails) {
            activeMedia.parentElement.scrollTo({ left: activeMedia.offsetLeft });
          }
          const activeMediaRect = activeMedia.getBoundingClientRect();
          // Don't scroll if the image is already in view
          if (activeMediaRect.top > -0.5) return;
          const top = activeMediaRect.top + window.scrollY;
          window.scrollTo({ top: top, behavior: 'smooth' });
        });
        this.playActiveMedia(activeMedia);

        if (!this.elements.thumbnails) return;
        const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
        this.setActiveThumbnail(activeThumbnail);
        this.announceLiveRegion(activeMedia, activeThumbnail.dataset.mediaPosition);
      }

      setActiveThumbnail(thumbnail) {
        if (!this.elements.thumbnails || !thumbnail) return;

        this.elements.thumbnails
          .querySelectorAll('button')
          .forEach((element) => element.removeAttribute('aria-current'));
        thumbnail.querySelector('button').setAttribute('aria-current', true);
        if (this.elements.thumbnails.isSlideVisible(thumbnail, 10)) return;

        this.elements.thumbnails.slider.scrollTo({ left: thumbnail.offsetLeft });
      }

      announceLiveRegion(activeItem, position) {
        const image = activeItem.querySelector('.product__modal-opener--image img');
        if (!image) return;
        image.onload = () => {
          this.elements.liveRegion.setAttribute('aria-hidden', false);
          this.elements.liveRegion.innerHTML = window.accessibilityStrings.imageAvailable.replace('[index]', position);
          setTimeout(() => {
            this.elements.liveRegion.setAttribute('aria-hidden', true);
          }, 2000);
        };
        image.src = image.src;
      }

      playActiveMedia(activeItem) {
        window.pauseAllMedia();
        const deferredMedia = activeItem.querySelector('.deferred-media');
        if (deferredMedia) deferredMedia.loadContent(false);
      }

      preventStickyHeader() {
        this.stickyHeader = this.stickyHeader || document.querySelector('sticky-header');
        if (!this.stickyHeader) return;
        this.stickyHeader.dispatchEvent(new Event('preventHeaderReveal'));
      }

      removeListSemantic() {
        if (!this.elements.viewer.slider) return;
        this.elements.viewer.slider.setAttribute('role', 'presentation');
        this.elements.viewer.sliderItems.forEach((slide) => slide.setAttribute('role', 'presentation'));
      }

      initGalleryPaginationDots() {
        if (this.__galleryDotsBound) return;
        const dotsNav = this.querySelector('[data-gallery-dots]');
        if (!dotsNav || !this.elements.viewer) return;
        const slider = this.elements.viewer.querySelector('[id^="Slider-"]');
        if (!slider) return;

        const slidesNow = Array.from(slider.querySelectorAll('li[data-media-id]'));
        if (!slidesNow.length) {
          this.__dotsInitAttempts = (this.__dotsInitAttempts || 0) + 1;
          if (this.__dotsInitAttempts < 12) {
            window.setTimeout(() => this.initGalleryPaginationDots(), 100);
          }
          return;
        }

        const dotButtons = Array.from(dotsNav.querySelectorAll('[data-slide-index]'));
        if (!dotButtons.length) return;

        const viewer = this.elements.viewer;

        const gallerySlides = () => Array.from(slider.querySelectorAll('li[data-media-id]'));

        const syncFromSlider = () => {
          const slides = gallerySlides();
          if (!slides.length || !dotButtons.length) return;

          const anchor = slider.scrollLeft + slider.clientWidth * 0.2;
          let activeIdx = 0;
          let bestDist = Infinity;
          slides.forEach((slide, idx) => {
            if (!slide.clientWidth) return;
            const left = slide.offsetLeft;
            const d = Math.abs(anchor - (left + slide.clientWidth * 0.15));
            if (d < bestDist) {
              bestDist = d;
              activeIdx = idx;
            }
          });

          dotButtons.forEach((btn, i) => {
            const on = i === activeIdx;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
          });
        };

        const onDotClick = (event) => {
          event.preventDefault();
          const btn = event.currentTarget;
          const i = Number(btn.dataset.slideIndex);
          const slides = gallerySlides();
          const slide = slides[i];
          if (!slide || !slide.clientWidth) return;

          slider.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' });

          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              if (typeof viewer.update === 'function') viewer.update();
              syncFromSlider();
            });
          });
        };

        slider.addEventListener('scroll', () => window.requestAnimationFrame(syncFromSlider), { passive: true });
        viewer.addEventListener('slideChanged', syncFromSlider);
        dotButtons.forEach((btn) => btn.addEventListener('click', onDotClick));

        this.__galleryDotsBound = true;
        window.requestAnimationFrame(syncFromSlider);
      }
    }
  );
}
