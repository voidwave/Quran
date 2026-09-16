/**
 * Shared PWA glue for index.html and index2.html:
 *
 *   - registers sw.js, which makes the app installable and keeps it working
 *     offline (see sw.js for what is cached and when);
 *   - adds a "تثبيت التطبيق" button to the tools menu on browsers that offer
 *     their own install prompt (Chromium, Android/desktop). On iOS the app
 *     installs through Safari's Share > Add to Home Screen, and this button
 *     simply never appears.
 */
(function () {
    'use strict';

    /* -----------------------------------------------------------------------
       Service worker
    ----------------------------------------------------------------------- */

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
                .catch(function (error) {
                    console.warn('Service worker registration failed:', error);
                });
        });
    }

    /* -----------------------------------------------------------------------
       Install button
    ----------------------------------------------------------------------- */

    var deferredPrompt = null;   // the browser's offer, kept until clicked
    var button = null;

    function isInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function buildButton() {
        var element = document.createElement('button');
        element.id = 'install-button';
        element.className = 'btn';
        element.type = 'button';
        element.title = 'تثبيت التطبيق على الجهاز';
        element.setAttribute('aria-label', 'تثبيت التطبيق');
        element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
            + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M12 3v11"></path><path d="m8 10 4 4 4-4"></path>'
            + '<path d="M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1"></path></svg>'
            + '<span class="btn__label">تثبيت التطبيق</span>';

        element.addEventListener('click', function () {
            if (!deferredPrompt) return;
            var prompt = deferredPrompt;
            deferredPrompt = null;   // the offer can only be used once
            prompt.prompt();
            prompt.userChoice.then(hideButton);
        });
        return element;
    }

    function showButton() {
        var tools = document.getElementById('appbar-tools');
        if (!tools || button) return;
        button = buildButton();
        tools.appendChild(button);
    }

    function hideButton() {
        if (button && button.parentNode) button.parentNode.removeChild(button);
        button = null;
    }

    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();   // the tools button asks when the reader is ready
        deferredPrompt = event;
        if (!isInstalled()) showButton();
    });

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        hideButton();
    });
})();
