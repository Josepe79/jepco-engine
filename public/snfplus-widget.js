(function() {
    const _script = document.currentScript;

    const GDPR_KEY  = 'jepco_snfplus_consent';
    const UID_KEY   = 'jepco_snfplus_uid';

    const CONFIG = {
        brandId:   (_script && _script.getAttribute('data-brand-id')) || 'snfplus_usuario',
        brandName: (_script && _script.getAttribute('data-env-label')) || 'SNF+',
        appUrl:    (_script && _script.getAttribute('data-app-url'))   || null,
        // Datos de contacto del mediador de seguros. Son datos profesionales de
        // una empresa, no datos personales del usuario: el bot los muestra para
        // que sepa a quién dirigirse con dudas de póliza.
        mediador:      (_script && _script.getAttribute('data-mediador'))       || null,
        mediadorEmail: (_script && _script.getAttribute('data-mediador-email')) || null,
        mediadorTel:   (_script && _script.getAttribute('data-mediador-tel'))   || null,
        baseUrl: (function() {
            if (_script && _script.getAttribute('data-api-url')) {
                return _script.getAttribute('data-api-url').replace(/\/$/, '');
            }
            if (_script && _script.src) {
                try { return new URL(_script.src).origin; } catch (e) {}
            }
            return '';
        })(),
        userId: (function() {
            try {
                var id = localStorage.getItem(UID_KEY);
                if (!id) {
                    id = (crypto && crypto.randomUUID)
                        ? crypto.randomUUID()
                        : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, function(c) {
                            return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
                          });
                    localStorage.setItem(UID_KEY, id);
                }
                return id;
            } catch (e) {
                return 'uid_' + Date.now().toString(36);
            }
        })(),
        primaryColor:   '#0047AB',
        secondaryColor: '#f4f7f9',
    };

    CONFIG.apiUrl    = CONFIG.baseUrl + '/api/chat';
    CONFIG.deleteUrl = CONFIG.baseUrl + '/api/my-data/' + CONFIG.userId;

    // ── Catálogos de opciones ──────────────────────────────────────────────────

    // Cada producto lleva su pregunta explícita en vez de un genérico "tengo
    // dudas sobre X". Dos motivos: la búsqueda semántica encuentra mucho mejor,
    // y en Salud evita que una pregunta ambigua se interprete como consulta de
    // coberturas y acabe derivada al mediador sin dar antes la parte fiscal.
    var PRODUCTS = [
        { label: 'Ahorro',      category: 'ahorro',     message: 'Como funciona el producto de Ahorro y que limites tiene' },
        { label: 'Comedor',     category: 'comida',     message: 'Como funciona el producto de Comedor y que limites tiene' },
        { label: 'Formación',   category: 'formacion',  message: 'Como funciona el producto de Formacion y que limites tiene' },
        { label: 'Guardería',   category: 'guarderia',  message: 'Como funciona el producto de Guarderia y que limites tiene' },
        { label: 'Transporte',  category: 'transporte', message: 'Como funciona el producto de Transporte y que limites tiene' },
        { label: 'Salud',       category: 'salud',      message: 'Como funciona el seguro de Salud, que limites de importe tiene y quien puede incluirse' },
        { label: 'Renting',     category: 'renting',    message: 'Como funciona el producto de Renting y que limites tiene' },
    ];

    var APP_SECTIONS = [
        { label: 'Acceso y login',        category: 'acceso_navegacion', message: 'Como accedo a la aplicacion SNF+ y navego por ella' },
        { label: 'Mi perfil',             category: 'perfil',            message: 'Como actualizo mi perfil personal en la aplicacion' },
        { label: 'Gestionar familiares',  category: 'familiares',        message: 'Como doy de alta a familiares en la aplicacion' },
        { label: 'Contratar un producto', category: 'productos_general', message: 'Como funciona el proceso de contratar un producto en la app' },
        { label: 'Contrato de Novación',  category: 'contrato_novacion', message: 'Que es el contrato de novacion y cuando tengo que firmarlo' },
    ];

    var RRHH_SECTIONS = [
        { label: 'Acceso y login',        category: 'acceso_navegacion',               message: 'Como accedo a la aplicacion SNF+ como responsable de RRHH' },
        { label: 'Empresas y sucursales', category: 'administracion_empresas_sucursales', message: 'Como gestiono empresas y sucursales en la plataforma' },
        { label: 'Grupos de trabajo',     category: 'administracion_grupos',           message: 'Como creo y gestiono grupos de trabajadores' },
        { label: 'Importación masiva',    category: 'importacion_y_actualizacion_masiva', message: 'Como importo o actualizo empleados de forma masiva con Excel' },
        { label: 'Gestión de empleados',  category: 'gestion_usuarios',                message: 'Como anado, edito o doy de baja a un empleado' },
        { label: 'Seguimiento de planes', category: 'seguimiento_planes',              message: 'Como hago seguimiento de los planes y aprobaciones pendientes' },
        { label: 'Informes de nómina',    category: 'informes',                        message: 'Como genero y descargo informes de nomina en Excel' },
    ];

    var GESTOR_SECTIONS = [
        { label: 'Onboarding compañías',  category: 'onboarding_companias',  message: 'Como realizo el alta y configuracion inicial de una nueva empresa en la plataforma' },
        { label: 'Administrar compañías', category: 'administrar_companias', message: 'Como gestiono y edito los datos de empresas registradas en el sistema' },
        { label: 'Resumen Salud',         category: 'resumen_salud',         message: 'Como consulto informes y estadisticas de los seguros de salud' },
        { label: 'Control compañías',     category: 'control_companias',     message: 'Como superviso y monitorizo la actividad de las companias en la plataforma' },
        { label: 'Contrataciones',        category: 'contrataciones',        message: 'Como gestiono y reviso las solicitudes de productos de retribucion flexible' },
    ];

    // ── Estilos ────────────────────────────────────────────────────────────────

    var styles = `
        #jepco-chat-widget {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #jepco-chat-bubble {
            width: 60px;
            height: 60px;
            background: ${CONFIG.primaryColor};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        #jepco-chat-bubble:hover { transform: scale(1.1); }
        #jepco-chat-bubble svg { width: 30px; height: 30px; fill: white; }
        #jepco-chat-window {
            width: min(380px, calc(100vw - 30px));
            height: min(600px, calc(100vh - 100px));
            background: white;
            position: absolute;
            bottom: 80px;
            right: 0;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
            display: none;
            flex-direction: column;
            overflow: hidden;
            animation: jepco-slide-up 0.4s ease-out;
        }
        @keyframes jepco-slide-up {
            from { opacity: 0; transform: translateY(20px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        #jepco-chat-header {
            background: ${CONFIG.primaryColor};
            color: white;
            padding: 15px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
            gap: 10px;
        }
        #jepco-chat-header h3 { margin: 0; font-size: 18px; font-weight: 600; flex: 1; }
        #jepco-menu-btn {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.4);
            color: white;
            padding: 5px 10px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
            transition: background 0.2s;
        }
        #jepco-menu-btn:hover { background: rgba(255,255,255,0.35); }
        #jepco-chat-messages {
            flex: 1;
            min-height: 0;
            padding: 20px;
            overflow-y: auto;
            background: ${CONFIG.secondaryColor};
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .jepco-msg {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 15px;
            font-size: 14px;
            line-height: 1.5;
        }
        .jepco-msg-bot {
            align-self: flex-start;
            background: white;
            color: #333;
            border-bottom-left-radius: 2px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        .jepco-msg-user {
            align-self: flex-end;
            background: ${CONFIG.primaryColor};
            color: white;
            border-bottom-right-radius: 2px;
        }
        .jepco-typing-indicator {
            align-self: flex-start;
            background: white;
            color: #888;
            padding: 10px 16px;
            border-radius: 15px;
            border-bottom-left-radius: 2px;
            font-size: 13px;
            font-style: italic;
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
            display: none;
        }
        #jepco-quick-actions {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: ${CONFIG.secondaryColor};
            border-top: 1px solid #e8e8e8;
            flex-shrink: 0;
            max-height: 230px;
            overflow-y: auto;
        }
        #jepco-consent-panel {
            padding: 16px 20px 20px;
            background: white;
            border-top: 1px solid #eee;
            flex-shrink: 0;
        }
        #jepco-consent-panel h4 {
            margin: 0 0 8px 0;
            font-size: 14px;
            color: #333;
        }
        #jepco-consent-panel p {
            margin: 0 0 13px 0;
            font-size: 12px;
            color: #555;
            line-height: 1.6;
        }
        .jepco-consent-btns { display: flex; gap: 8px; }
        #jepco-consent-accept {
            flex: 1;
            background: ${CONFIG.primaryColor};
            color: white;
            border: none;
            padding: 9px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
        }
        #jepco-consent-accept:hover { opacity: 0.88; }
        #jepco-consent-reject {
            flex: 1;
            background: white;
            color: #666;
            border: 1px solid #ddd;
            padding: 9px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
        }
        #jepco-chat-input-container {
            padding: 12px 15px;
            background: white;
            border-top: 1px solid #eee;
            display: flex;
            gap: 10px;
            flex-shrink: 0;
        }
        #jepco-chat-input {
            flex: 1;
            border: 1px solid #ddd;
            padding: 10px 15px;
            border-radius: 25px;
            outline: none;
            font-size: 14px;
        }
        #jepco-chat-send {
            background: ${CONFIG.primaryColor};
            color: white;
            border: none;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        #jepco-gdpr-footer {
            text-align: center;
            padding: 3px 15px 6px;
            background: white;
            flex-shrink: 0;
        }
        #jepco-delete-link {
            font-size: 11px;
            color: #ccc;
            text-decoration: none;
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
            font-family: inherit;
        }
        #jepco-delete-link:hover { color: #999; text-decoration: underline; }
        .jepco-action-btn {
            background: white;
            border: 1px solid ${CONFIG.primaryColor};
            color: ${CONFIG.primaryColor};
            padding: 8px 12px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 13px;
            text-align: left;
            transition: all 0.2s;
        }
        .jepco-action-btn:hover { background: ${CONFIG.primaryColor}; color: white; }
        .jepco-sub-btn {
            background: #fff;
            border: 1px solid #ddd;
            padding: 6px 8px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            text-align: left;
            transition: all 0.2s;
        }
        .jepco-sub-btn:hover { background: ${CONFIG.primaryColor}; color: white; border-color: ${CONFIG.primaryColor}; }
        .jepco-back-btn { background: #eee !important; color: #333 !important; border-color: #ddd !important; }
        .jepco-back-btn:hover { background: #ddd !important; color: #333 !important; }

        /* ── Touch: elimina el retraso de 300ms en iOS/Android ────────────── */
        #jepco-chat-bubble, #jepco-chat-send, #jepco-menu-btn, #jepco-close,
        #jepco-consent-accept, #jepco-consent-reject, #jepco-delete-link,
        .jepco-action-btn, .jepco-sub-btn {
            touch-action: manipulation;
        }

        /* ── Área de toque mínima para el botón cerrar ─────────────────────── */
        #jepco-close {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 36px;
            min-height: 36px;
            margin: -6px -4px;
            border-radius: 6px;
        }

        /* ── Móvil: ventana casi pantalla completa ──────────────────────────── */
        @media (max-width: 450px) {
            #jepco-chat-widget {
                bottom: max(12px, env(safe-area-inset-bottom, 12px));
                right: 12px;
            }
            #jepco-chat-window {
                position: fixed;
                left: 10px;
                right: 10px;
                bottom: 82px;
                width: auto;
                height: calc(100vh - 100px);
                border-radius: 16px;
            }
            #jepco-chat-header {
                padding: 12px 15px;
            }
            #jepco-chat-header h3 {
                font-size: 16px;
            }
            #jepco-menu-btn {
                font-size: 11px;
                padding: 4px 8px;
            }
            #jepco-quick-actions {
                max-height: 185px;
            }
            #jepco-chat-messages {
                padding: 15px;
            }
        }
    `;

    var styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    // ── DOM ────────────────────────────────────────────────────────────────────

    var widgetContainer = document.createElement('div');
    widgetContainer.id = 'jepco-chat-widget';
    widgetContainer.innerHTML = `
        <div id="jepco-chat-bubble">
            <svg viewBox="0 0 24 24"><path d="M20,2H4C2.9,2,2,2.9,2,4v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z"/></svg>
        </div>
        <div id="jepco-chat-window">
            <div id="jepco-chat-header">
                <h3>${CONFIG.brandName} Support</h3>
                <button id="jepco-menu-btn">&#9776; Opciones</button>
                <span id="jepco-close" style="cursor:pointer;font-size:22px;line-height:1">&times;</span>
            </div>
            <div id="jepco-chat-messages">
                <div class="jepco-msg jepco-msg-bot">Hola! Soy el asistente de ${CONFIG.brandName}. ¿En qué puedo ayudarte hoy?</div>
                <div class="jepco-typing-indicator" id="jepco-typing">El asistente está escribiendo...</div>
            </div>
            <div id="jepco-consent-panel">
                <h4>Aviso de privacidad</h4>
                <p>Este asistente guarda tus mensajes para darte un servicio personalizado. Los datos se conservan durante 90 días y puedes borrarlos en cualquier momento. Al continuar aceptas el tratamiento de tus conversaciones conforme al RGPD.</p>
                <div class="jepco-consent-btns">
                    <button id="jepco-consent-accept">Aceptar y continuar</button>
                    <button id="jepco-consent-reject">No, gracias</button>
                </div>
            </div>
            <div id="jepco-quick-actions"></div>
            <div id="jepco-chat-input-container">
                <input type="text" id="jepco-chat-input" placeholder="Escribe tu mensaje...">
                <button id="jepco-chat-send">
                    <svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="white"><path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"/></svg>
                </button>
            </div>
            <div id="jepco-gdpr-footer">
                <button id="jepco-delete-link">Borrar mis datos</button>
            </div>
        </div>
    `;
    document.body.appendChild(widgetContainer);

    var bubble            = document.getElementById('jepco-chat-bubble');
    var chatWindow        = document.getElementById('jepco-chat-window');
    var closeBtn          = document.getElementById('jepco-close');
    var menuBtn           = document.getElementById('jepco-menu-btn');
    var input             = document.getElementById('jepco-chat-input');
    var sendBtn           = document.getElementById('jepco-chat-send');
    var messagesContainer = document.getElementById('jepco-chat-messages');
    var typingIndicator   = document.getElementById('jepco-typing');
    var quickActions      = document.getElementById('jepco-quick-actions');
    var consentPanel      = document.getElementById('jepco-consent-panel');
    var inputContainer    = document.getElementById('jepco-chat-input-container');
    var gdprFooter        = document.getElementById('jepco-gdpr-footer');

    // ── RGPD ───────────────────────────────────────────────────────────────────

    function hasConsent() {
        try {
            var c = localStorage.getItem(GDPR_KEY);
            if (!c) return false;
            var parsed = JSON.parse(c);
            return parsed && parsed.accepted === true;
        } catch (e) { return false; }
    }

    function storeConsent() {
        try {
            localStorage.setItem(GDPR_KEY, JSON.stringify({
                accepted: true,
                timestamp: new Date().toISOString()
            }));
        } catch (e) {}
    }

    function showConsentPanel() {
        consentPanel.style.display  = 'block';
        quickActions.style.display  = 'none';
        inputContainer.style.display = 'none';
        gdprFooter.style.display    = 'none';
    }

    function acceptConsent() {
        storeConsent();
        consentPanel.style.display  = 'none';
        inputContainer.style.display = 'flex';
        gdprFooter.style.display    = 'block';
        showMainMenu();
    }

    document.getElementById('jepco-consent-accept').addEventListener('click', acceptConsent);

    document.getElementById('jepco-consent-reject').addEventListener('click', function() {
        consentPanel.innerHTML = '<p style="text-align:center;color:#666;font-size:13px;padding:16px 0">Para usar el chat es necesario aceptar el aviso de privacidad.</p>';
    });

    document.getElementById('jepco-delete-link').addEventListener('click', function() {
        // Confirmación inline — no usamos confirm() porque se bloquea en iframes
        var existing = document.getElementById('jepco-delete-confirm');
        if (existing) { existing.remove(); return; }

        var confirmPanel = document.createElement('div');
        confirmPanel.id = 'jepco-delete-confirm';
        confirmPanel.style.cssText = 'padding:10px 15px 12px; background:#fff8e1; border-top:1px solid #ffe082; flex-shrink:0; font-size:12px; color:#5d4037;';
        confirmPanel.innerHTML =
            '<p style="margin:0 0 8px 0">¿Seguro? Esto borrará tu historial y no se puede deshacer.</p>' +
            '<div style="display:flex;gap:8px;">' +
            '<button id="jepco-del-yes" style="flex:1;background:#c62828;color:white;border:none;padding:7px;border-radius:6px;cursor:pointer;font-size:12px;touch-action:manipulation">Sí, borrar</button>' +
            '<button id="jepco-del-no"  style="flex:1;background:#757575;color:white;border:none;padding:7px;border-radius:6px;cursor:pointer;font-size:12px;touch-action:manipulation">Cancelar</button>' +
            '</div>';

        chatWindow.insertBefore(confirmPanel, gdprFooter);

        document.getElementById('jepco-del-no').addEventListener('click', function() {
            confirmPanel.remove();
        });

        document.getElementById('jepco-del-yes').addEventListener('click', function() {
            confirmPanel.remove();
            fetch(CONFIG.deleteUrl, { method: 'DELETE' })
                .then(function() {
                    try {
                        localStorage.removeItem(UID_KEY);
                        localStorage.removeItem(GDPR_KEY);
                    } catch (e) {}
                    addMessage('Tus datos han sido eliminados. Cierra y vuelve a abrir el chat para comenzar de nuevo.', 'bot');
                    quickActions.style.display   = 'none';
                    inputContainer.style.display = 'none';
                    gdprFooter.style.display     = 'none';
                })
                .catch(function() {
                    addMessage('No se pudieron eliminar los datos. Inténtalo de nuevo más tarde.', 'bot');
                });
        });
    });

    // ── Menús ──────────────────────────────────────────────────────────────────

    var MAIN_MENU_ITEMS = [
        'Dudas sobre la retribución flexible',
        'Dudas sobre un producto específico',
        'Dudas con la aplicación',
    ];

    function showMainMenu() {
        var profileSections = CONFIG.brandId === 'snfplus_rrhh'   ? RRHH_SECTIONS
                            : CONFIG.brandId === 'snfplus_gestor' ? GESTOR_SECTIONS
                            : null;

        if (profileSections) {
            var html = '<div style="font-size:12px; margin-bottom:5px; color:#666">¿En qué puedo ayudarte?</div>';
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">';
            profileSections.forEach(function(s) {
                html += '<button class="jepco-sub-btn" data-category="' + s.category + '" data-msg="' + s.message + '">' + s.label + '</button>';
            });
            html += '</div>';
            quickActions.innerHTML = html;
            quickActions.style.display = 'flex';
            bindAppSubButtons();
            return;
        }
        var html = '';
        MAIN_MENU_ITEMS.forEach(function(label) {
            html += '<button class="jepco-action-btn">' + label + '</button>';
        });
        quickActions.innerHTML = html;
        quickActions.style.display = 'flex';
        bindMainButtons();
    }

    function showProductSubmenu() {
        var html = '<div style="font-size:12px; margin-bottom:5px; color:#666">Elige un producto:</div>';
        html += '<div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">';
        PRODUCTS.forEach(function(p) {
            html += '<button class="jepco-sub-btn" data-category="' + p.category + '" data-msg="' + p.message + '">' + p.label + '</button>';
        });
        html += '<button class="jepco-sub-btn jepco-back-btn" style="grid-column: span 2">&#8592; Volver</button>';
        html += '</div>';
        quickActions.innerHTML = html;
        bindProductSubButtons();
    }

    function showAppSubmenu() {
        var html = '<div style="font-size:12px; margin-bottom:5px; color:#666">¿Sobre qué sección?</div>';
        html += '<div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">';
        APP_SECTIONS.forEach(function(s) {
            html += '<button class="jepco-sub-btn" data-category="' + s.category + '" data-msg="' + s.message + '">' + s.label + '</button>';
        });
        html += '<button class="jepco-sub-btn jepco-back-btn" style="grid-column: span 2">&#8592; Volver</button>';
        html += '</div>';
        quickActions.innerHTML = html;
        bindAppSubButtons();
    }

    function bindMainButtons() {
        quickActions.querySelectorAll('.jepco-action-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var text = btn.textContent.trim();
                if (text.includes('producto')) {
                    showProductSubmenu();
                } else if (text.includes('aplicación') || text.includes('aplicacion')) {
                    showAppSubmenu();
                } else {
                    var cat = (text.includes('retribución') || text.includes('retribucion')) ? 'retribucion_general' : null;
                    input.value = text;
                    quickActions.style.display = 'none';
                    sendMessage(cat);
                }
            });
        });
    }

    function bindProductSubButtons() {
        quickActions.querySelectorAll('.jepco-sub-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (btn.classList.contains('jepco-back-btn')) { showMainMenu(); return; }
                var category = btn.getAttribute('data-category');
                var msg      = btn.getAttribute('data-msg');
                input.value = msg || ('Tengo dudas sobre el producto: ' + btn.textContent.trim());
                quickActions.style.display = 'none';
                sendMessage(category);
            });
        });
    }

    function bindAppSubButtons() {
        quickActions.querySelectorAll('.jepco-sub-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (btn.classList.contains('jepco-back-btn')) { showMainMenu(); return; }
                var category = btn.getAttribute('data-category');
                var msg      = btn.getAttribute('data-msg');
                input.value = msg;
                quickActions.style.display = 'none';
                sendMessage(category);
            });
        });
    }

    // ── Chat ───────────────────────────────────────────────────────────────────

    async function sendMessage(category) {
        var text = input.value.trim();
        if (!text) return;

        addMessage(text, 'user');
        input.value = '';

        messagesContainer.appendChild(typingIndicator);
        typingIndicator.style.display = 'block';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        try {
            var response = await fetch(CONFIG.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message:  text,
                    brandId:  CONFIG.brandId,
                    userId:   CONFIG.userId,
                    category: category || null,
                    appUrl:   CONFIG.appUrl  || null,
                    mediador:      CONFIG.mediador      || null,
                    mediadorEmail: CONFIG.mediadorEmail || null,
                    mediadorTel:   CONFIG.mediadorTel   || null
                })
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);

            var data = await response.json();
            typingIndicator.style.display = 'none';
            addMessage(data.reply || 'Lo siento, no he podido procesar tu solicitud.', 'bot');
        } catch (error) {
            typingIndicator.style.display = 'none';
            addMessage('Error de conexión con el servidor. Por favor, inténtalo de nuevo.', 'bot');
        }
    }

    function addMessage(text, sender) {
        var msgDiv = document.createElement('div');
        msgDiv.className = 'jepco-msg jepco-msg-' + sender;
        msgDiv.textContent = text;
        messagesContainer.insertBefore(msgDiv, typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // ── Eventos ────────────────────────────────────────────────────────────────

    bubble.addEventListener('click', function() {
        if (chatWindow.style.display === 'flex') {
            chatWindow.style.display = 'none';
        } else {
            chatWindow.style.display = 'flex';
            if (!hasConsent()) showConsentPanel();
        }
    });

    closeBtn.addEventListener('click', function() {
        chatWindow.style.display = 'none';
    });

    menuBtn.addEventListener('click', function() {
        if (hasConsent()) showMainMenu();
    });

    sendBtn.addEventListener('click', function() { sendMessage(null); });

    input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') sendMessage(null);
    });

    // ── Init ───────────────────────────────────────────────────────────────────

    if (hasConsent()) {
        consentPanel.style.display   = 'none';
        gdprFooter.style.display     = 'block';
        showMainMenu();
    } else {
        consentPanel.style.display   = 'block';
        quickActions.style.display   = 'none';
        inputContainer.style.display = 'none';
        gdprFooter.style.display     = 'none';
    }

})();
