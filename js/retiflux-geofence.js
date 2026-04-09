/**
 * RetiFlux™ — facility geofence for ticket / PRT view (app/ticket-view.html).
 * Query-string “bypass” tokens are NOT honored — they defeated on-site verification.
 * Only localhost/127.0.0.1 skips the check (local dev). Everyone else: GPS inside fence or denied UI.
 */
(function () {
    if (window.RetifluxGeofence) return;

    var GEOFENCE = {
        lat: -1.049636,
        lng: 37.085402,
        radiusMeters: 200,
        maxAccuracyMeters: 50
    };

    var GEOFENCE_DENIED_MESSAGES = [
        'Looks like you\'re not quite where you need to be. When you\'re ready, come find us — we\'ll be waiting.',
        'Our GPS sensors are picky. They only wave you through when you\'re in the right spot. Try again when you\'ve arrived.',
        'Access denied — but don\'t take it personally. Even the best of us have been told to come back later.',
        'You\'re in the wrong neighborhood for this party. Swing by the right place and we\'ll roll out the welcome mat.',
        'The system says no for now. Location says you\'re not there yet. When you are, give it another shot.',
        'Oops — we can\'t verify where you are. Head to the right place, enable location, and try again.',
        'Almost there isn\'t close enough. Get to the spot, and we\'ll unlock the gate.',
        'Our virtual bouncer is strict. Show up at the right location and you\'re in.',
        'Location check failed. No worries — find the right spot, hit Try Again, and we\'ll sort it out.',
        'We couldn\'t place you. Make sure location\'s on, get where you need to be, and try again.'
    ];

    function isLocalDevHost() {
        try {
            var h = location.hostname || '';
            return h === 'localhost' || h === '127.0.0.1';
        } catch (e) {
            return false;
        }
    }

    function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
        var R = 6371000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function checkGeofenceAccess() {
        return new Promise(function (resolve) {
            if (!navigator.geolocation) {
                resolve({ ok: false, reason: 'Geolocation not supported' });
                return;
            }
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    var accuracy = pos.coords.accuracy;
                    if (accuracy > GEOFENCE.maxAccuracyMeters) {
                        resolve({ ok: false, reason: 'GPS accuracy too low', accuracy: accuracy, required: GEOFENCE.maxAccuracyMeters });
                        return;
                    }
                    var dist = haversineDistanceMeters(
                        GEOFENCE.lat, GEOFENCE.lng,
                        pos.coords.latitude, pos.coords.longitude
                    );
                    if (dist > GEOFENCE.radiusMeters) {
                        resolve({ ok: false, reason: 'Outside allowed area', distance: Math.round(dist), limit: GEOFENCE.radiusMeters });
                        return;
                    }
                    resolve({ ok: true, accuracy: Math.round(accuracy), distance: Math.round(dist) });
                },
                function (err) {
                    var msg = err.code === 1 ? 'Location permission denied' : (err.message || 'Could not get location');
                    resolve({ ok: false, reason: msg });
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });
    }

    function showGeofenceDenied() {
        var idx = 1;
        function nextMessage() {
            var msg = GEOFENCE_DENIED_MESSAGES[idx % GEOFENCE_DENIED_MESSAGES.length];
            var el = document.getElementById('geofenceMsgRotate');
            if (el) {
                el.style.opacity = '0';
                setTimeout(function () {
                    if (el) { el.textContent = msg; el.style.opacity = '1'; }
                }, 200);
            }
            idx++;
        }
        document.body.innerHTML =
            '<div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">' +
            '<div style="text-align: center; padding: 48px 40px; background: rgba(15, 23, 42, 0.95); border-radius: 16px; border: 2px solid rgba(239, 68, 68, 0.5); max-width: 440px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">' +
            '<div style="font-size: 48px; margin-bottom: 16px;">🔒</div>' +
            '<h1 style="color: #fca5a5; margin-bottom: 16px; font-size: 22px; font-weight: 700;">Access Denied</h1>' +
            '<p id="geofenceMsgRotate" style="color: #cbd5e1; font-size: 15px; line-height: 1.7; min-height: 4.5em; transition: opacity 0.4s ease;">' + GEOFENCE_DENIED_MESSAGES[0] + '</p>' +
            '<p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">💡 Ensure location services are enabled for this browser.</p>' +
            '<button type="button" onclick="window.location.reload()" style="margin-top: 28px; padding: 12px 24px; background: linear-gradient(135deg, #4f46e5, #6366f1); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">Try Again</button>' +
            '<div style="margin-top: 30px; padding-top: 18px; border-top: 1px solid rgba(245,158,11,0.2); text-align: center; font-size: 12px; color: #64748b; letter-spacing: 0.5px; font-weight: 500;">' +
            '<strong style="color:#fbbf24;font-weight:700;">RetiFlux™</strong> Powered by <strong style="color:#818cf8;font-weight:700;">NexGridCore DataLabs</strong></div></div></div>';
        setInterval(nextMessage, 15000);
    }

    /**
     * @param {URLSearchParams} params unused (kept for call-site compatibility)
     * @returns {Promise<boolean>} true if view may load; false if denied (UI shown)
     */
    function requireForView(params) {
        if (isLocalDevHost()) return Promise.resolve(true);
        return checkGeofenceAccess().then(function (result) {
            if (result.ok) return true;
            showGeofenceDenied();
            return false;
        });
    }

    window.RetifluxGeofence = {
        requireForView: requireForView,
        checkGeofenceAccess: checkGeofenceAccess
    };
})();
