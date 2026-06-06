(function() {
    // Capture currentScript synchronously before any async code runs
    const _script = document.currentScript;

    // Auto-detect API URL from the script's src so the widget works in any environment
    const CONFIG = {
        brandId: 'snfplus',
        brandName: 'SNF Plus',
        apiUrl: (function() {
            if (_script && _script.getAttribute('data-api-url')) {
                return _script.getAttribute('data-api-url').replace(/\/$/, '') + '/api/chat';
            }
            if (_script && _script.src) {
                try {
                    return new URL(_script.src).origin + '/api/chat';
                } catch (e) {}
            }
            return '/api/chat';
        })(),
        // Persist userId across page loads so conversation history is maintained
        userId: (function() {
            var key = 'jepco_snfplus_uid';
            try {
                var id = localStorage.getItem(key);
                if (!id) {
                    id = 'web_' + Math.random().toString(36).substr(2, 9);
                    localStorage.setItem(key, id);
                }
                return id;
            } catch (e) {
                return 'web_' + Math.random().toString(36).substr(2, 9);
            }
        })(),
        primaryColor: '#0047AB',
        secondaryColor: '#f4f7f9',
        botAvatar: 'https://cdn-icons-png.flaticon.com/512/4712/4712035.png',
        userAvatar: 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png'
    };

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

        #jepco-chat-bubble:hover {
            transform: scale(1.1);
        }

        #jepco-chat-bubble svg {
            width: 30px;
            height: 30px;
            fill: white;
        }

        #jepco-chat-window {
            width: 380px;
            height: 600px;
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
            to { opacity: 1; transform: translateY(0); }
        }

        #jepco-chat-header {
            background: ${CONFIG.primaryColor};
            color: white;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }

        #jepco-chat-header h3 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        #jepco-chat-messages {
            flex: 1;
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
        }

        #jepco-chat-input-container {
            padding: 15px;
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

        .jepco-action-btn:hover {
            background: ${CONFIG.primaryColor};
            color: white;
        }

        .jepco-sub-btn {
            background: #fff;
            border: 1px solid #ddd;
            padding: 6px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }

        .jepco-sub-btn:hover {
            background: ${CONFIG.primaryColor};
            color: white;
            border-color: ${CONFIG.primaryColor};
        }
    `;

    var styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    var widgetContainer = document.createElement('div');
    widgetContainer.id = 'jepco-chat-widget';
    widgetContainer.innerHTML = `
        <div id="jepco-chat-bubble">
            <svg viewBox="0 0 24 24"><path d="M20,2H4C2.9,2,2,2.9,2,4v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z"/></svg>
        </div>
        <div id="jepco-chat-window">
            <div id="jepco-chat-header">
                <h3>${CONFIG.brandName} Support</h3>
                <span id="jepco-close" style="cursor:pointer;font-size:22px;line-height:1">&times;</span>
            </div>
            <div id="jepco-chat-messages">
                <div class="jepco-msg jepco-msg-bot">¡Hola! Soy el asistente de ${CONFIG.brandName}. ¿En qué puedo ayudarte hoy?</div>
                <div class="jepco-typing-indicator" id="jepco-typing">El asistente está escribiendo...</div>
            </div>
            <div id="jepco-quick-actions"></div>
            <div id="jepco-chat-input-container">
                <input type="text" id="jepco-chat-input" placeholder="Escribe tu mensaje...">
                <button id="jepco-chat-send">
                    <svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="white"><path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"/></svg>
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(widgetContainer);

    var bubble = document.getElementById('jepco-chat-bubble');
    var chatWindow = document.getElementById('jepco-chat-window');
    var closeBtn = document.getElementById('jepco-close');
    var input = document.getElementById('jepco-chat-input');
    var sendBtn = document.getElementById('jepco-chat-send');
    var messagesContainer = document.getElementById('jepco-chat-messages');
    var typingIndicator = document.getElementById('jepco-typing');
    var quickActions = document.getElementById('jepco-quick-actions');

    // ── Menu management ────────────────────────────────────────────────────────

    var MAIN_MENU_HTML = `
        <button class="jepco-action-btn">1- ¿Dudas con la retribución flexible en general?</button>
        <button class="jepco-action-btn">2- ¿Dudas con la retribución flexible de un producto?</button>
        <button class="jepco-action-btn">3- ¿Dudas con la aplicación?</button>
    `;

    var PRODUCT_SUBMENU_HTML = `
        <div style="font-size:12px; margin-bottom:5px; color:#666">Elige un producto:</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
            <button class="jepco-sub-btn">Ahorro</button>
            <button class="jepco-sub-btn">Comedor</button>
            <button class="jepco-sub-btn">Formación</button>
            <button class="jepco-sub-btn">Guardería</button>
            <button class="jepco-sub-btn">Transporte</button>
            <button class="jepco-sub-btn">Salud</button>
            <button class="jepco-sub-btn" style="grid-column: span 2; background:#eee; color:#333">⬅ Volver</button>
        </div>
    `;

    function showMainMenu() {
        quickActions.innerHTML = MAIN_MENU_HTML;
        quickActions.style.display = 'flex';
        bindMainButtons();
    }

    function showProductSubmenu() {
        quickActions.innerHTML = PRODUCT_SUBMENU_HTML;
        bindSubButtons();
    }

    function bindMainButtons() {
        quickActions.querySelectorAll('.jepco-action-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var text = btn.textContent.trim();
                if (text.includes('un producto')) {
                    showProductSubmenu();
                } else {
                    input.value = text;
                    quickActions.style.display = 'none';
                    sendMessage();
                }
            });
        });
    }

    function bindSubButtons() {
        quickActions.querySelectorAll('.jepco-sub-btn').forEach(function(subBtn) {
            subBtn.addEventListener('click', function() {
                if (subBtn.textContent.includes('Volver')) {
                    showMainMenu();
                    return;
                }
                var product = subBtn.textContent.trim();
                input.value = 'Tengo dudas sobre el producto: ' + product;
                quickActions.style.display = 'none';
                sendMessage(product.toLowerCase());
            });
        });
    }

    // ── Chat logic ─────────────────────────────────────────────────────────────

    async function sendMessage(category) {
        var text = input.value.trim();
        if (!text) return;

        addMessage(text, 'user');
        input.value = '';

        // Move typing indicator after last message and show it
        messagesContainer.appendChild(typingIndicator);
        typingIndicator.style.display = 'block';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        try {
            var response = await fetch(CONFIG.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    brandId: CONFIG.brandId,
                    userId: CONFIG.userId,
                    category: category || null
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
        // Insert before the typing indicator so it always stays last
        messagesContainer.insertBefore(msgDiv, typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // ── Event listeners ────────────────────────────────────────────────────────

    bubble.addEventListener('click', function() {
        chatWindow.style.display = chatWindow.style.display === 'flex' ? 'none' : 'flex';
    });

    closeBtn.addEventListener('click', function() {
        chatWindow.style.display = 'none';
    });

    sendBtn.addEventListener('click', function() { sendMessage(); });

    input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') sendMessage();
    });

    // Initialize main menu
    showMainMenu();

})();
