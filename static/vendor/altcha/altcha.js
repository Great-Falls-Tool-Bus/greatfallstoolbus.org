/*
 * altcha.js - self-hosted ALTCHA proof-of-work widget for the GFTB contact form.
 *
 * Implements the ALTCHA SHA-256 challenge/response protocol (https://altcha.org,
 * MIT). This is an independent, dependency-free client: it registers the
 * <altcha-widget> custom element, GETs a signed challenge, brute-forces the
 * SHA-256 preimage off the render path, and exposes the base64 solution so the
 * page can ride it on its existing JSON POST. The wire format matches the stock
 * `altcha` widget (pinned reference v3.2.0) and the handler's stdlib verify, so
 * either client interoperates with the same server.
 *
 * Why a small reimplementation rather than the upstream bundle: it mirrors the
 * handler's own stdlib-mirror doctrine (verify is hand-written SHA-256 + HMAC in
 * Python, not a vendored wheel), keeps the asset auditable, and is CSP-clean -
 * no eval, no WebAssembly, no blob/Worker construction, no CDN, no external
 * runtime fetch beyond the challenge URL. Styling is applied via element.style
 * from script (not inline <style> or style attributes), so a strict CSP needs
 * only: script-src 'self'; connect-src <form endpoint>.
 *
 * License: MIT (see ./LICENSE). Provenance and pin: see ./README.md.
 */
(function () {
	'use strict';

	if (typeof window === 'undefined' || !window.customElements) return;
	if (window.customElements.get('altcha-widget')) return;

	// --- SHA-256 over a UTF-8 string -> lowercase hex (byte-exact vs the pod's
	// hashlib and node:crypto; validated against RFC vectors before vendoring).
	function altchaSha256Hex(input) {
		var K = [
			0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
			0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
			0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
			0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
			0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
			0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
			0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
			0xc67178f2,
		];
		var bytes = [];
		for (var i = 0; i < input.length; i++) {
			var c = input.charCodeAt(i);
			if (c < 0x80) {
				bytes.push(c);
			} else if (c < 0x800) {
				bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
			} else if (c >= 0xd800 && c <= 0xdbff) {
				var c2 = input.charCodeAt(++i);
				c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
				bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
			} else {
				bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
			}
		}
		var bitLen = bytes.length * 8;
		bytes.push(0x80);
		while (bytes.length % 64 !== 56) bytes.push(0);
		var hi = Math.floor(bitLen / 0x100000000);
		var lo = bitLen >>> 0;
		bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
		bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

		var h0 = 0x6a09e667,
			h1 = 0xbb67ae85,
			h2 = 0x3c6ef372,
			h3 = 0xa54ff53a,
			h4 = 0x510e527f,
			h5 = 0x9b05688c,
			h6 = 0x1f83d9ab,
			h7 = 0x5be0cd19;
		var w = new Array(64);
		function rotr(x, n) {
			return (x >>> n) | (x << (32 - n));
		}
		for (var off = 0; off < bytes.length; off += 64) {
			for (var t = 0; t < 16; t++) {
				w[t] =
					(bytes[off + t * 4] << 24) |
					(bytes[off + t * 4 + 1] << 16) |
					(bytes[off + t * 4 + 2] << 8) |
					bytes[off + t * 4 + 3];
			}
			for (var j = 16; j < 64; j++) {
				var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
				var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
				w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
			}
			var a = h0,
				b = h1,
				c = h2,
				d = h3,
				e = h4,
				f = h5,
				g = h6,
				h = h7;
			for (var k = 0; k < 64; k++) {
				var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
				var ch = (e & f) ^ (~e & g);
				var t1 = (h + S1 + ch + K[k] + w[k]) | 0;
				var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
				var maj = (a & b) ^ (a & c) ^ (b & c);
				var t2 = (S0 + maj) | 0;
				h = g;
				g = f;
				f = e;
				e = (d + t1) | 0;
				d = c;
				c = b;
				b = a;
				a = (t1 + t2) | 0;
			}
			h0 = (h0 + a) | 0;
			h1 = (h1 + b) | 0;
			h2 = (h2 + c) | 0;
			h3 = (h3 + d) | 0;
			h4 = (h4 + e) | 0;
			h5 = (h5 + f) | 0;
			h6 = (h6 + g) | 0;
			h7 = (h7 + h) | 0;
		}
		function toHex(x) {
			return ('00000000' + (x >>> 0).toString(16)).slice(-8);
		}
		return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
	}

	function toBase64(str) {
		var encoder = new TextEncoder();
		var arr = encoder.encode(str);
		var bin = '';
		for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
		return btoa(bin);
	}

	var UNVERIFIED = 'unverified';
	var VERIFYING = 'verifying';
	var VERIFIED = 'verified';
	var ERROR = 'error';

	// Hard cap on brute-force work regardless of a challenge's maxnumber, so a
	// hostile or misconfigured server cannot pin the tab.
	var MAX_ITERATIONS = 5000000;
	var CHUNK = 2000;

	class AltchaWidget extends HTMLElement {
		connectedCallback() {
			if (!this._built) {
				this._payload = '';
				this._state = UNVERIFIED;
				this._solving = false;
				this._build();
				this._built = true;
			}
			var auto = (this.getAttribute('auto') || 'onload').toLowerCase();
			if (auto !== 'off') {
				var self = this;
				var schedule = window.requestIdleCallback
					? function (cb) {
							window.requestIdleCallback(cb, { timeout: 1500 });
						}
					: function (cb) {
							setTimeout(cb, 200);
						};
				schedule(function () {
					self.solve();
				});
			}
		}

		get payload() {
			return this._payload || '';
		}

		get state() {
			return this._state;
		}

		_build() {
			var row = document.createElement('span');
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '0.625rem';
			row.style.width = '100%';

			this._indicator = document.createElement('span');
			this._indicator.setAttribute('aria-hidden', 'true');
			this._indicator.style.display = 'inline-flex';
			this._indicator.style.alignItems = 'center';
			this._indicator.style.justifyContent = 'center';
			this._indicator.style.width = '1rem';
			this._indicator.style.height = '1rem';
			this._indicator.style.flex = '0 0 auto';
			this._indicator.style.boxSizing = 'border-box';
			this._indicator.style.borderRadius = '0'; // house canon: zero radius
			this._indicator.style.fontSize = '0.85rem';
			this._indicator.style.lineHeight = '1';

			var textWrap = document.createElement('span');
			textWrap.style.display = 'flex';
			textWrap.style.flexDirection = 'column';
			textWrap.style.lineHeight = '1.25';
			textWrap.style.minWidth = '0';

			this._label = document.createElement('span');
			this._label.textContent = this.getAttribute('label') || 'Human verification';
			this._label.style.fontWeight = '600';

			this._status = document.createElement('span');
			this._status.setAttribute('role', 'status');
			this._status.setAttribute('aria-live', 'polite');
			this._status.style.opacity = '0.75';
			this._status.style.fontSize = '0.85em';

			textWrap.appendChild(this._label);
			textWrap.appendChild(this._status);

			this._input = document.createElement('input');
			this._input.type = 'hidden';
			this._input.name = this.getAttribute('name') || 'altcha';

			row.appendChild(this._indicator);
			row.appendChild(textWrap);
			this.appendChild(row);
			this.appendChild(this._input);

			this._render(UNVERIFIED, 'Ready.');
		}

		_render(state, statusText) {
			this._state = state;
			if (this._status) this._status.textContent = statusText;
			if (!this._indicator) return;
			if (state === VERIFIED) {
				this._indicator.textContent = '✓'; // check mark
				this._indicator.style.border = '0';
				this._indicator.style.opacity = '1';
				this._indicator.style.fontWeight = '700';
			} else if (state === ERROR) {
				this._indicator.textContent = '!';
				this._indicator.style.border = '2px solid currentColor';
				this._indicator.style.opacity = '0.6';
				this._indicator.style.fontWeight = '700';
			} else {
				this._indicator.textContent = '';
				this._indicator.style.border = '2px solid currentColor';
				this._indicator.style.opacity = state === VERIFYING ? '0.85' : '0.5';
				this._indicator.style.fontWeight = '400';
			}
		}

		_emit(name, detail) {
			this.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true, composed: true }));
		}

		_brute(salt, target, max) {
			return new Promise(function (resolve) {
				var n = 0;
				var ceiling = Math.min(max, MAX_ITERATIONS);
				function step() {
					var end = Math.min(n + CHUNK, ceiling);
					for (; n <= end; n++) {
						if (altchaSha256Hex(salt + String(n)) === target) {
							resolve(n);
							return;
						}
					}
					if (n > ceiling) {
						resolve(null);
						return;
					}
					setTimeout(step, 0);
				}
				step();
			});
		}

		reset() {
			this._payload = '';
			if (this._input) this._input.value = '';
			this._render(UNVERIFIED, 'Ready.');
		}

		solve() {
			var self = this;
			if (this._solving || this._state === VERIFIED) {
				return Promise.resolve(this._payload || '');
			}
			var url = this.getAttribute('challengeurl');
			if (!url) {
				this._render(ERROR, 'Not configured.');
				return Promise.resolve('');
			}
			this._solving = true;
			this._render(VERIFYING, 'Verifying you are human...');
			return fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' })
				.then(function (res) {
					if (!res.ok) throw new Error('challenge ' + res.status);
					return res.json();
				})
				.then(function (ch) {
					if (!ch || ch.algorithm !== 'SHA-256' || typeof ch.challenge !== 'string' || typeof ch.salt !== 'string') {
						throw new Error('bad challenge');
					}
					var max = typeof ch.maxnumber === 'number' && ch.maxnumber > 0 ? ch.maxnumber : 100000;
					return self._brute(ch.salt, ch.challenge, max).then(function (number) {
						if (number === null) throw new Error('unsolved');
						var body = {
							algorithm: 'SHA-256',
							challenge: ch.challenge,
							number: number,
							salt: ch.salt,
							signature: ch.signature,
						};
						self._payload = toBase64(JSON.stringify(body));
						self._input.value = self._payload;
						self._render(VERIFIED, 'Verified.');
						self._emit('verified', { payload: self._payload });
						self._emit('statechange', { state: VERIFIED, payload: self._payload });
						return self._payload;
					});
				})
				.catch(function (err) {
					self._payload = '';
					if (self._input) self._input.value = '';
					self._render(ERROR, 'Verification unavailable. You can still send.');
					self._emit('error', { error: String((err && err.message) || err) });
					self._emit('statechange', { state: ERROR, payload: '' });
					return '';
				})
				.then(function (payload) {
					self._solving = false;
					return payload;
				});
		}
	}

	window.customElements.define('altcha-widget', AltchaWidget);
})();
