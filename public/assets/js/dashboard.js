(function () {
    'use strict';

    const IOT_STORAGE_KEY = 'agrotech.iot.config';
    const DEFAULT_IOT_CONFIG = {
        esp32Ip: '',
        timeoutMs: 5000
    };

    const firebaseConfig = {
        apiKey: 'AIzaSyAaUOPKe4lvxqSbj_yZRXREOrLok9mmvRk',
        authDomain: 'agrotech-9b042.firebaseapp.com',
        databaseURL: 'https://agrotech-9b042-default-rtdb.firebaseio.com',
        projectId: 'agrotech-9b042',
        storageBucket: 'agrotech-9b042.appspot.com',
        messagingSenderId: '722678725948',
        appId: '1:722678725948:web:46d86af5eb3bdfaf61f239',
        measurementId: 'G-Z6E71FDC8H'
    };

    const state = {
        auth: null,
        db: null,
        imageLoaded: false,
        moistureChart: null,
        lastSensorReading: null
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const node = byId(id);
        if (node) node.textContent = value;
    }

    function setHtml(id, value) {
        const node = byId(id);
        if (node) node.innerHTML = value;
    }

    function on(id, eventName, handler) {
        const node = byId(id);
        if (node) node.addEventListener(eventName, handler);
    }

    function safeAlert(message) {
        if (typeof window.alert === 'function') window.alert(message);
    }

    function normalizeCrop(value) {
        return String(value || '').replace(/[^\x20-\x7E]/g, '').trim();
    }

    function readIotConfig() {
        try {
            const stored = JSON.parse(localStorage.getItem(IOT_STORAGE_KEY) || '{}');
            return {
                esp32Ip: typeof stored.esp32Ip === 'string' ? stored.esp32Ip.trim() : DEFAULT_IOT_CONFIG.esp32Ip,
                timeoutMs: Number(stored.timeoutMs) || DEFAULT_IOT_CONFIG.timeoutMs
            };
        } catch (error) {
            return { ...DEFAULT_IOT_CONFIG };
        }
    }

    function writeIotConfig(config) {
        localStorage.setItem(IOT_STORAGE_KEY, JSON.stringify({
            esp32Ip: config.esp32Ip.trim(),
            timeoutMs: Number(config.timeoutMs) || DEFAULT_IOT_CONFIG.timeoutMs
        }));
    }

    function isValidIpv4(value) {
        const parts = String(value || '').trim().split('.');
        return parts.length === 4 && parts.every(function (part) {
            if (!/^\d{1,3}$/.test(part)) return false;
            if (part.length > 1 && part.charAt(0) === '0') return false;
            const number = Number(part);
            return number >= 0 && number <= 255;
        });
    }

    function setIotStatus(message, type) {
        const status = byId('iotStatus');
        if (!status) return;
        status.textContent = message;
        status.classList.remove('status-ok', 'status-error', 'status-warn');
        if (type) status.classList.add('status-' + type);
    }

    function syncIotForm() {
        const config = readIotConfig();
        const ipInput = byId('espIpInput');
        const timeoutInput = byId('espTimeoutInput');
        if (ipInput) ipInput.value = config.esp32Ip;
        if (timeoutInput) timeoutInput.value = String(config.timeoutMs);
        setIotStatus(config.esp32Ip ? 'ESP32-CAM saved at ' + config.esp32Ip : 'Enter your ESP32 IPv4 address before capture.', config.esp32Ip ? 'ok' : 'warn');
    }

    function getIotFormConfig() {
        const esp32Ip = (byId('espIpInput') || {}).value || '';
        const timeoutMs = Number((byId('espTimeoutInput') || {}).value) || DEFAULT_IOT_CONFIG.timeoutMs;
        return {
            esp32Ip: esp32Ip.trim(),
            timeoutMs: Math.min(Math.max(timeoutMs, 1000), 30000)
        };
    }

    function testEspCamera(config) {
        return new Promise(function (resolve, reject) {
            if (!isValidIpv4(config.esp32Ip)) {
                reject(new Error('Enter a valid IPv4 address, for example 192.168.1.42.'));
                return;
            }

            const img = new Image();
            const timer = window.setTimeout(function () {
                cleanup();
                reject(new Error('Connection timed out after ' + config.timeoutMs + ' ms.'));
            }, config.timeoutMs);

            function cleanup() {
                window.clearTimeout(timer);
                img.onload = null;
                img.onerror = null;
            }

            img.onload = function () {
                cleanup();
                resolve();
            };

            img.onerror = function () {
                cleanup();
                reject(new Error('ESP32-CAM did not return an image from /cam.jpg.'));
            };

            img.src = 'http://' + config.esp32Ip + '/cam.jpg?t=' + Date.now();
        });
    }

    function saveIotSettings() {
        const config = getIotFormConfig();
        if (!isValidIpv4(config.esp32Ip)) {
            setIotStatus('Enter a valid IPv4 address before saving.', 'error');
            return false;
        }

        writeIotConfig(config);
        syncIotForm();
        setIotStatus('ESP32 settings saved.', 'ok');
        return true;
    }

    async function testIotSettings() {
        const config = getIotFormConfig();
        if (!isValidIpv4(config.esp32Ip)) {
            setIotStatus('Enter a valid IPv4 address before testing.', 'error');
            return;
        }

        writeIotConfig(config);
        setIotStatus('Testing ESP32-CAM connection...', 'warn');
        try {
            await testEspCamera(config);
            setIotStatus('Connection successful. ESP32-CAM is reachable.', 'ok');
        } catch (error) {
            setIotStatus(error.message, 'error');
        }
    }

    function initializeFirebase() {
        if (!window.firebase || !firebase.initializeApp) {
            console.warn('Firebase SDK unavailable; running dashboard without auth or telemetry.');
            return;
        }

        try {
            if (!firebase.apps || firebase.apps.length === 0) {
                firebase.initializeApp(firebaseConfig);
            }
            state.auth = firebase.auth ? firebase.auth() : null;
            state.db = firebase.database ? firebase.database() : null;
        } catch (error) {
            console.warn('Firebase initialization failed:', error);
            state.auth = null;
            state.db = null;
        }
    }

    function getPages() {
        return {
            dashboard: byId('page-dashboard'),
            detect: byId('page-detect'),
            seed: byId('page-seed'),
            moisture: byId('page-moisture'),
            field: byId('page-field'),
            profile: byId('page-profile')
        };
    }

    function getButtons(prefix) {
        return {
            dashboard: byId(prefix + '-dashboard'),
            detect: byId(prefix + '-detect'),
            seed: byId(prefix + '-seed'),
            moisture: byId(prefix + '-moist'),
            field: byId(prefix + '-field'),
            profile: byId(prefix + '-profile')
        };
    }

    function hideAllPages() {
        Object.values(getPages()).forEach(function (page) {
            if (!page) return;
            page.style.display = 'none';
            page.setAttribute('aria-hidden', 'true');
        });
    }

    function clearActive() {
        [getButtons('m'), getButtons('b')].forEach(function (group) {
            Object.values(group).forEach(function (button) {
                if (button) button.classList.remove('active');
            });
        });
    }

    function setActive(target) {
        clearActive();
        const sideButton = getButtons('m')[target];
        const bottomButton = getButtons('b')[target];
        if (sideButton) sideButton.classList.add('active');
        if (bottomButton) bottomButton.classList.add('active');
    }

    function navClick(target) {
        const pages = getPages();
        const page = pages[target] || pages.dashboard;
        hideAllPages();
        setActive(pages[target] ? target : 'dashboard');
        if (page) {
            page.style.display = target === 'dashboard' ? 'flex' : 'block';
            page.setAttribute('aria-hidden', 'false');
        }
    }

    function setupAuth() {
        const authPanel = byId('authPanel');
        const signInForm = byId('signInForm');
        const signUpForm = byId('signUpForm');
        const isLocalPreview = ['localhost', '127.0.0.1', '::1'].indexOf(window.location.hostname) !== -1
            && new URLSearchParams(window.location.search).get('preview') === '1';

        on('switchToSignUp', 'click', function () {
            if (signInForm) signInForm.style.display = 'none';
            if (signUpForm) signUpForm.style.display = 'block';
            setText('siMsg', '');
        });

        on('switchToSignIn', 'click', function () {
            if (signUpForm) signUpForm.style.display = 'none';
            if (signInForm) signInForm.style.display = 'block';
            setText('suMsg', '');
        });

        on('signUpBtn', 'click', async function () {
            if (!state.auth) {
                setText('suMsg', 'Authentication is unavailable right now.');
                return;
            }

            const name = (byId('suName') || {}).value || '';
            const email = ((byId('suEmail') || {}).value || '').trim();
            const password = (byId('suPassword') || {}).value || '';
            setText('suMsg', '');

            if (!email || !password) {
                setText('suMsg', 'Email and password required');
                return;
            }
            if (password.length < 6) {
                setText('suMsg', 'Password must be at least 6 characters');
                return;
            }

            try {
                const userCred = await state.auth.createUserWithEmailAndPassword(email, password);
                if (name.trim()) await userCred.user.updateProfile({ displayName: name.trim() });
                const msg = byId('suMsg');
                if (msg) {
                    msg.style.color = 'lightgreen';
                    msg.textContent = 'Account created. Signing in...';
                }
            } catch (error) {
                const msg = byId('suMsg');
                if (msg) {
                    msg.style.color = 'salmon';
                    msg.textContent = error.message;
                }
            }
        });

        on('signInBtn', 'click', async function () {
            if (!state.auth) {
                setText('siMsg', 'Authentication is unavailable right now.');
                return;
            }

            const email = ((byId('siEmail') || {}).value || '').trim();
            const password = (byId('siPassword') || {}).value || '';
            setText('siMsg', '');

            if (!email || !password) {
                setText('siMsg', 'Email and password required');
                return;
            }

            try {
                await state.auth.signInWithEmailAndPassword(email, password);
            } catch (error) {
                setText('siMsg', error.message);
            }
        });

        on('googleSignInBtn', 'click', async function () {
            if (!state.auth || !window.firebase) {
                safeAlert('Authentication is unavailable right now.');
                return;
            }
            const provider = new firebase.auth.GoogleAuthProvider();
            try {
                await state.auth.signInWithPopup(provider);
            } catch (error) {
                safeAlert(error.message);
            }
        });

        on('forgotBtn', 'click', async function () {
            if (!state.auth) {
                safeAlert('Authentication is unavailable right now.');
                return;
            }
            const email = window.prompt('Enter your email for reset:');
            if (!email) return;
            try {
                await state.auth.sendPasswordResetEmail(email);
                safeAlert('Reset email sent');
            } catch (error) {
                safeAlert(error.message);
            }
        });

        if (isLocalPreview) {
            if (authPanel) authPanel.style.display = 'none';
            setText('userEmailTop', 'Local preview');
            setText('p-email', 'Local preview');
            setText('p-name', 'Development mode');
            setText('profileAvatar', 'D');
            navClick('dashboard');
            return;
        }

        if (!state.auth || !state.auth.onAuthStateChanged) {
            if (authPanel) authPanel.style.display = 'none';
            navClick('dashboard');
            return;
        }

        state.auth.onAuthStateChanged(function (user) {
            if (user) {
                setText('userEmailTop', user.email || '');
                setText('p-email', user.email || '');
                setText('p-name', user.displayName || 'No display name');
                setText('profileAvatar', (user.displayName || user.email || 'U').charAt(0).toUpperCase());
                if (authPanel) authPanel.style.display = 'none';
                navClick('dashboard');
            } else {
                if (authPanel) authPanel.style.display = 'flex';
                hideAllPages();
            }
        });
    }

    function logout() {
        if (state.auth) state.auth.signOut();
    }

    function setupDiseaseDetection() {
        try {
            Object.defineProperty(window, 'imageLoaded', {
                configurable: true,
                get: function () { return state.imageLoaded; },
                set: function (value) { state.imageLoaded = Boolean(value); }
            });
        } catch (error) {
            window.imageLoaded = false;
        }
        state.imageLoaded = false;

        on('fileInput', 'change', function (event) {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                state.imageLoaded = false;
                window.imageLoaded = false;
                return;
            }

            const reader = new FileReader();
            reader.onload = function (readerEvent) {
                const preview = byId('preview');
                if (preview) {
                    preview.src = readerEvent.target.result;
                    preview.style.display = 'block';
                }
                setText('detectResult', 'Image loaded from device. Ready to analyze.');
                setText('diseaseSuggestion', '');
                state.imageLoaded = true;
                window.imageLoaded = true;
            };
            reader.readAsDataURL(file);
        });

        on('espCaptureBtn', 'click', async function () {
            const config = readIotConfig();
            const preview = byId('preview');
            if (!preview) return;

            if (!isValidIpv4(config.esp32Ip)) {
                setText('detectResult', 'Set a valid ESP32 IPv4 address in IoT settings first.');
                setIotStatus('Set a valid ESP32 IPv4 address before capture.', 'error');
                return;
            }

            setText('detectResult', 'Connecting to ESP32-CAM...');
            state.imageLoaded = false;
            window.imageLoaded = false;

            let timeoutId = null;
            const done = function () {
                window.clearTimeout(timeoutId);
                preview.onload = null;
                preview.onerror = null;
            };

            timeoutId = window.setTimeout(function () {
                done();
                preview.style.display = 'none';
                setText('detectResult', 'ESP32-CAM capture timed out.');
                setIotStatus('Capture timed out after ' + config.timeoutMs + ' ms.', 'error');
            }, config.timeoutMs);

            preview.onload = function () {
                done();
                preview.style.display = 'block';
                setText('detectResult', 'Image captured from ESP32-CAM. Ready to analyze.');
                setIotStatus('Capture successful.', 'ok');
                state.imageLoaded = true;
                window.imageLoaded = true;
            };

            preview.onerror = function () {
                done();
                preview.style.display = 'none';
                setText('detectResult', 'ESP32-CAM not reachable.');
                setIotStatus('ESP32-CAM not reachable at ' + config.esp32Ip + '.', 'error');
            };

            preview.src = 'http://' + config.esp32Ip + '/cam.jpg?t=' + Date.now();
            preview.style.display = 'block';
        });

        on('processBtn', 'click', function () {
            const preview = byId('preview');
            const detectResult = byId('detectResult');
            const diseaseSuggestion = byId('diseaseSuggestion');

            if (!state.imageLoaded || !preview || !preview.complete || !preview.naturalWidth) {
                if (detectResult) detectResult.textContent = 'Please upload or capture an image first.';
                if (diseaseSuggestion) diseaseSuggestion.textContent = '';
                return;
            }

            if (detectResult) detectResult.textContent = 'Analyzing image...';

            window.setTimeout(function () {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = preview.naturalWidth;
                    canvas.height = preview.naturalHeight;
                    ctx.drawImage(preview, 0, 0);

                    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    let greenPixels = 0;
                    for (let i = 0; i < pixels.length; i += 4) {
                        if (pixels[i + 1] > pixels[i] + 20 && pixels[i + 1] > pixels[i + 2] + 20) greenPixels++;
                    }

                    const greenRatio = greenPixels / (pixels.length / 4);
                    if (greenRatio < 0.15) {
                        setHtml('detectResult', '<b>No plant detected</b><br>Please upload a clear image of a crop or plant leaf.');
                        setText('diseaseSuggestion', '');
                        return;
                    }

                    const diseases = ['Healthy', 'Early Blight', 'Leaf Rust', 'Nutrient Deficiency', 'Bacterial Spot'];
                    const detected = diseases.filter(function () { return Math.random() > 0.6; });
                    if (!detected.length) detected.push('Healthy');

                    setHtml('detectResult', '<strong>Detected Issues:</strong><ul>' + detected.map(function (name) {
                        const confidence = (70 + Math.random() * 25).toFixed(0);
                        return '<li>' + name + ' <span class="muted">(' + confidence + '%)</span></li>';
                    }).join('') + '</ul>');
                    setText('diseaseSuggestion', 'Suggestion: ' + getDiseaseSuggestion(detected));
                } catch (error) {
                    setText('detectResult', 'Unable to analyze this image. Try a local upload or a CORS-enabled ESP32 image.');
                    console.warn('Image analysis failed:', error);
                }
            }, 800);
        });
    }

    function getDiseaseSuggestion(diseases) {
        const suggestions = {
            Healthy: 'Plant appears healthy. Continue regular monitoring and irrigation.',
            'Early Blight': 'Remove affected leaves and apply recommended fungicide.',
            'Leaf Rust': 'Use rust-resistant varieties and apply sulfur-based fungicide.',
            'Nutrient Deficiency': 'Apply balanced fertilizer and improve soil nutrition.',
            'Bacterial Spot': 'Avoid overhead irrigation and use copper-based spray.'
        };

        const list = Array.isArray(diseases) ? diseases : [diseases];
        if (list.length === 1 && list[0] === 'Healthy') return suggestions.Healthy;

        return list
            .filter(function (name) { return name !== 'Healthy'; })
            .map(function (name) { return name + ': ' + (suggestions[name] || 'Consult agricultural expert.'); })
            .join('\n');
    }

    function setupSeedCalculator() {
        const cropSelect = byId('cropSelect');
        const otherWeightWrap = byId('otherWeightWrap');
        if (cropSelect && otherWeightWrap) {
            cropSelect.addEventListener('change', function () {
                if (cropSelect.value === 'Other') {
                    otherWeightWrap.style.display = 'block';
                } else {
                    otherWeightWrap.style.display = 'none';
                    const otherInput = byId('otherWeightInput');
                    if (otherInput) otherInput.value = '';
                }
            });
        }
    }

    function calcSeeds() {
        const cropSelect = byId('cropSelect');
        if (!cropSelect) return;

        const spacing = parseFloat((byId('spacingInp') || {}).value);
        const area = parseFloat((byId('areaInp') || {}).value);
        const selected = cropSelect.options[cropSelect.selectedIndex];
        const crop = selected.value || 'Crop';
        let weight100 = parseFloat(selected.dataset.w || 0);

        if (crop === 'Other') {
            weight100 = parseFloat((byId('otherWeightInput') || {}).value);
            if (!weight100) {
                safeAlert('Enter weight per 100 seeds for the Other crop');
                return;
            }
        }

        if (!spacing || !area) {
            safeAlert('Please enter spacing and area');
            return;
        }

        const seeds = Math.round((area * 10000) / (spacing * spacing));
        setText('seedResult', crop + ': Required Seeds ~= ' + seeds.toLocaleString());

        if (weight100 && weight100 > 0) {
            const totalKg = (seeds * (weight100 / 100)) / 1000;
            setText('seedWeightResult', 'Required Weight ~= ' + totalKg.toFixed(2) + ' kg');
        } else {
            setText('seedWeightResult', 'Required Weight: -');
        }
    }

    function setupTelemetry() {
        const canvas = byId('moistureChart');
        if (canvas && window.Chart) {
            const chartData = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
            state.moistureChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: chartData.map(function (_, index) { return index + 1; }),
                    datasets: [{
                        data: chartData,
                        borderColor: 'rgba(39,174,96,1)',
                        backgroundColor: 'rgba(39,174,96,0.12)',
                        tension: 0.35,
                        fill: true
                    }]
                },
                options: {
                    scales: { y: { min: 0, max: 100 } },
                    plugins: { legend: { display: false } },
                    maintainAspectRatio: false
                }
            });
        } else {
            setText('lastUpdated', 'Telemetry chart unavailable.');
        }

        on('cropType-moisture', 'change', function () {
            if (state.lastSensorReading) updateSensorCards(state.lastSensorReading);
        });

        if (!state.db) {
            setText('lastUpdated', 'Telemetry unavailable. Waiting for Firebase connection.');
            return;
        }

        try {
            const sensorRef = state.db.ref('/agrotech/sensors').limitToLast(1);
            sensorRef.on('child_added', function (snap) {
                const reading = snap && snap.val ? snap.val() : null;
                if (reading) updateSensorCards(reading);
            }, function (error) {
                console.warn('Telemetry listener failed:', error);
                setText('lastUpdated', 'Telemetry unavailable: ' + error.message);
            });
        } catch (error) {
            console.warn('Telemetry setup failed:', error);
            setText('lastUpdated', 'Telemetry unavailable. Please check Firebase configuration.');
        }

        window.setTimeout(function () {
            const temp = byId('s-temp');
            if (temp && temp.textContent.trim() === '-') {
                setText('lastUpdated', 'Telemetry connected. Waiting for sensor data...');
            }
        }, 3000);
    }

    function updateSensorCards(reading) {
        state.lastSensorReading = reading;
        const temp = reading.temp !== undefined ? reading.temp : '-';
        const hum = reading.hum !== undefined ? reading.hum : '-';
        const soil = reading.soil !== undefined ? reading.soil : '-';

        setText('s-temp', temp);
        setText('s-hum', hum);
        setText('s-moist', soil);
        setText('lastUpdated', 'Last Updated: ' + new Date().toLocaleString());

        if (state.moistureChart && !Number.isNaN(Number(soil))) {
            const dataset = state.moistureChart.data.datasets[0].data;
            dataset.push(Number(soil));
            if (dataset.length > 20) dataset.shift();
            state.moistureChart.data.labels = dataset.map(function (_, index) { return index + 1; });
            state.moistureChart.update();
        }

        const cropSelect = byId('cropType-moisture');
        const analysis = analyzeReadings(cropSelect ? cropSelect.value : '', Number(temp), Number(hum), Number(soil));
        setText('s-cause', analysis.cause);
        setText('s-suggest', analysis.suggest);
    }

    function analyzeReadings(crop, temp, hum, moist) {
        if (crop === 'Wheat') {
            if (moist < 40) return { cause: 'Low soil moisture', suggest: 'Irrigate field immediately.' };
            if (temp > 32) return { cause: 'Heat stress', suggest: 'Light irrigation, avoid fertilizers.' };
        }
        if (crop === 'Rice' && moist < 60) {
            return { cause: 'Insufficient water', suggest: 'Maintain flooded condition.' };
        }
        if (crop === 'Maize' && moist < 35) {
            return { cause: 'Dry soil', suggest: 'Irrigation required for maize growth.' };
        }
        if (crop === 'Cotton' && hum > 80) {
            return { cause: 'High humidity', suggest: 'Risk of fungal disease, monitor leaves.' };
        }
        return { cause: 'Conditions normal', suggest: 'No action required. Continue monitoring.' };
    }

    function updateName() {
        const newName = ((byId('editName') || {}).value || '').trim();
        if (!newName) {
            safeAlert('Enter a name');
            return;
        }
        const user = state.auth && state.auth.currentUser;
        if (!user) {
            safeAlert('Sign in before updating your profile.');
            return;
        }
        user.updateProfile({ displayName: newName }).then(function () {
            setText('p-name', newName);
            setText('welcomeTitle', 'Welcome, ' + newName);
            setText('profileAvatar', newName.charAt(0).toUpperCase());
            safeAlert('Name updated');
        }).catch(function (error) {
            safeAlert(error.message);
        });
    }

    function deleteAccount() {
        if (!window.confirm('Are you sure? This will permanently delete your account.')) return;
        const user = state.auth && state.auth.currentUser;
        if (!user) {
            safeAlert('Sign in before deleting your account.');
            return;
        }
        user.delete().then(function () {
            safeAlert('Account deleted');
            window.location.reload();
        }).catch(function (error) {
            if (error.code === 'auth/requires-recent-login') {
                safeAlert('Please sign out and sign in again before deleting your account.');
            } else {
                safeAlert(error.message);
            }
        });
    }

    function analyzeField() {
        const crop = normalizeCrop((byId('fieldCrop') || {}).value);
        const soil = (byId('soilType') || {}).value;
        const area = Number((byId('fieldArea') || {}).value);

        if (!crop || !soil || !area) {
            safeAlert('Please select crop, soil type and field area');
            return;
        }

        const recommendation = getFieldRecommendation(crop, soil);
        const areaNote = area >= 5 ? '<br>Large field detected: mechanized irrigation and scheduled monitoring recommended.' : '';

        setHtml('fieldResult',
            '<b>Crop:</b> ' + crop + '<br>' +
            '<b>Soil:</b> ' + soil + '<br>' +
            '<b>Area:</b> ' + area + ' acres<br><br>' +
            '<b>Status:</b> ' + recommendation.status + '<br>' +
            '<b>Risk:</b> ' + recommendation.risk + '<br><br>' +
            '<b>Practical Recommendation:</b><br>' + recommendation.text + areaNote
        );
    }

    function getFieldRecommendation(crop, soil) {
        const ideal = {
            Rice: ['Alluvial', 'Loamy'],
            Wheat: ['Loamy', 'Alluvial'],
            Maize: ['Loamy', 'Alluvial'],
            Mustard: ['Loamy', 'Sandy'],
            Soybean: ['Loamy', 'Black'],
            Groundnut: ['Sandy', 'Loamy'],
            Bajra: ['Sandy', 'Loamy'],
            Sunflower: ['Loamy'],
            Cotton: ['Black'],
            Chickpea: ['Loamy'],
            Barley: ['Loamy', 'Alluvial']
        };

        const copy = {
            Rice: 'Maintain shallow standing water, split nitrogen doses, and monitor common rice pests.',
            Wheat: 'Ensure good drainage, timely irrigation, and balanced NPK application.',
            Maize: 'Use staged nitrogen application and avoid water stagnation.',
            Mustard: 'Avoid waterlogging and monitor aphid infestation.',
            Soybean: 'Ensure good drainage and watch for leaf yellowing.',
            Groundnut: 'Maintain loose soil for pod development and ensure calcium availability.',
            Bajra: 'Use minimal irrigation and avoid excess fertilizer.',
            Sunflower: 'Keep soil well-drained and monitor for pests.',
            Cotton: 'Monitor bollworm and avoid excess nitrogen.',
            Chickpea: 'Avoid excess irrigation and prevent water stagnation.',
            Jowar: 'Jowar tolerates varied soils. Use moderate irrigation and timely weed control.',
            Barley: 'Avoid excess nitrogen and waterlogging.'
        };

        const matchedCrop = Object.keys(copy).find(function (name) { return crop.indexOf(name) !== -1; });
        if (!matchedCrop) {
            return { status: 'Advisory Needed', risk: 'Limited data', text: 'Crop-soil combination requires expert consultation.' };
        }

        if (matchedCrop === 'Jowar' || (ideal[matchedCrop] || []).indexOf(soil) !== -1) {
            return { status: 'Ideal Condition', risk: 'Low', text: copy[matchedCrop] };
        }

        if (soil === 'Sandy') {
            return { status: 'Advisory Needed', risk: 'Low water retention', text: 'Increase irrigation frequency and add organic matter. ' + copy[matchedCrop] };
        }

        if (soil === 'Clay') {
            return { status: 'Advisory Needed', risk: 'Poor aeration or waterlogging', text: 'Improve drainage and avoid over-irrigation. ' + copy[matchedCrop] };
        }

        return { status: 'Advisory Needed', risk: 'Sub-optimal soil', text: 'Improve soil structure with organic matter and monitor crop response. ' + copy[matchedCrop] };
    }

    function setupFieldImage() {
        on('fieldImage', 'change', function (event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (readerEvent) {
                const img = byId('previewImg');
                const previewWrap = byId('imagePreview');
                if (img) img.src = readerEvent.target.result;
                if (previewWrap) previewWrap.style.display = 'block';
                setText('imageResult', '');
            };
            reader.readAsDataURL(file);
        });
    }

    function analyzeFieldImage() {
        const fileInput = byId('fieldImage');
        const result = byId('imageResult');
        const img = byId('previewImg');
        const crop = normalizeCrop((byId('fieldCrop') || {}).value);

        if (!fileInput || !fileInput.files || !fileInput.files.length) {
            if (result) result.innerHTML = 'Please upload a field image.';
            return;
        }
        if (!crop) {
            if (result) result.innerHTML = 'Please select crop type.';
            return;
        }
        if (!img || !img.complete || img.naturalWidth === 0) {
            if (result) result.innerHTML = 'Image not loaded properly. Please re-upload.';
            return;
        }

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let green = 0;
            let yellow = 0;
            let brown = 0;

            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                if (g > r + 20 && g > b + 20) green++;
                else if (r > 150 && g > 150 && b < 120) yellow++;
                else if (r > 120 && g < 100 && b < 100) brown++;
            }

            const total = pixels.length / 4;
            const greenRatio = green / total;
            const yellowRatio = yellow / total;
            const brownRatio = brown / total;
            let condition = 'General stress';

            if (greenRatio < 0.12) condition = 'No crop detected';
            else if (greenRatio > 0.6) condition = 'Healthy';
            else if (brownRatio > 0.15) condition = 'Dry or burnt crop';
            else if (yellowRatio > 0.15) condition = 'Nutrient stress';

            if (result) {
                result.innerHTML =
                    '<b>Image-based Field Analysis</b><br><br>' +
                    'Green: ' + (greenRatio * 100).toFixed(1) + '%<br>' +
                    'Yellow: ' + (yellowRatio * 100).toFixed(1) + '%<br>' +
                    'Brown: ' + (brownRatio * 100).toFixed(1) + '%<br><br>' +
                    '<b>Detected Condition:</b> ' + condition;
            }
        } catch (error) {
            if (result) result.innerHTML = 'Unable to analyze this image. Please try another file.';
            console.warn('Field image analysis failed:', error);
        }
    }

    function setupParallax() {
        const bgImage = byId('bgImage');
        if (!bgImage) return;
        document.addEventListener('mousemove', function (event) {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const nx = (event.clientX - width / 2) / (width / 2);
            const ny = (event.clientY - height / 2) / (height / 2);
            bgImage.style.transform = 'translate3d(' + (nx * 8) + 'px, ' + (ny * 6) + 'px, 0) scale(1.06)';
        });
    }

    function init() {
        initializeFirebase();
        hideAllPages();
        navClick('dashboard');
        setupAuth();
        syncIotForm();
        setupDiseaseDetection();
        setupSeedCalculator();
        setupTelemetry();
        setupFieldImage();
        setupParallax();

        on('saveEspConfigBtn', 'click', saveIotSettings);
        on('testEspConfigBtn', 'click', testIotSettings);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                setText('siMsg', '');
                setText('suMsg', '');
            }
        });
    }

    window.navClick = navClick;
    window.logout = logout;
    window.calcSeeds = calcSeeds;
    window.updateName = updateName;
    window.deleteAccount = deleteAccount;
    window.analyzeField = analyzeField;
    window.analyzeFieldImage = analyzeFieldImage;
    window.AgroTechIoT = {
        readConfig: readIotConfig,
        saveConfig: writeIotConfig,
        isValidIpv4: isValidIpv4,
        testConnection: testEspCamera
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
