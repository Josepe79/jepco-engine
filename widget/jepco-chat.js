class JepcoChat extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.brandId = this.getAttribute('brand-id') || 'saludflex';
    this.apiUrl = this.getAttribute('api-url') || 'http://localhost:3000';
    this.userId = this.getUserId();
    this.isOpen = false;
  }

  getUserId() {
    let id = localStorage.getItem('jepco_user_id');
    if (!id) {
      id = 'web_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('jepco_user_id', id);
    }
    return id;
  }

  connectedCallback() {
    this.render();
  }

  toggleChat() {
    this.isOpen = !this.isOpen;
    const chatWindow = this.shadowRoot.querySelector('.chat-window');
    chatWindow.style.display = this.isOpen ? 'flex' : 'none';
  }

  async sendMessage() {
    const input = this.shadowRoot.querySelector('#chat-input');
    const text = input.value.trim();
    if (!text) return;

    this.addMessage('user', text);
    input.value = '';

    try {
      const response = await fetch(`${this.apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId: this.brandId,
          userId: this.userId,
          message: text
        })
      });

      const data = await response.json();
      this.addMessage('ai', data.reply);
    } catch (error) {
      console.error('Chat Error:', error);
      this.addMessage('ai', 'Lo siento, hay un problema de conexión. Inténtalo de nuevo más tarde.');
    }
  }

  addMessage(role, text) {
    const container = this.shadowRoot.querySelector('.messages-container');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.textContent = text;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --primary-color: #3b82f6;
          --bg-dark: #0f172a;
          --text-light: #f8fafc;
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          z-index: 9999;
          font-family: 'Inter', sans-serif;
        }

        .chat-trigger {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: var(--primary-color);
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.3s ease;
        }

        .chat-trigger:hover { transform: scale(1.1); }

        .chat-window {
          position: absolute;
          bottom: 80px;
          right: 0;
          width: 350px;
          height: 500px;
          background: var(--bg-dark);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          display: none;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          backdrop-filter: blur(10px);
        }

        .chat-header {
          padding: 1.5rem;
          background: rgba(255,255,255,0.05);
          border-bottom: 1px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .chat-header h3 { margin: 0; font-size: 1rem; color: var(--text-light); }

        .messages-container {
          flex: 1;
          padding: 1.5rem;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .message {
          max-width: 80%;
          padding: 0.75rem 1rem;
          border-radius: 15px;
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .message.user {
          align-self: flex-end;
          background: var(--primary-color);
          color: white;
          border-bottom-right-radius: 2px;
        }

        .message.ai {
          align-self: flex-start;
          background: rgba(255,255,255,0.1);
          color: var(--text-light);
          border-bottom-left-radius: 2px;
        }

        .chat-input-area {
          padding: 1rem;
          background: rgba(0,0,0,0.2);
          display: flex;
          gap: 0.5rem;
        }

        input {
          flex: 1;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 0.75rem;
          color: white;
          outline: none;
        }

        button#send-btn {
          background: var(--primary-color);
          border: none;
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 10px;
          cursor: pointer;
        }
      </style>

      <div class="chat-window">
        <div class="chat-header">
          <div style="width: 10px; height: 10px; background: #4ade80; border-radius: 50%;"></div>
          <h3>Soporte JEPCO (${this.brandId})</h3>
        </div>
        <div class="messages-container">
          <div class="message ai">¡Hola! Soy el asistente de ${this.brandId}. ¿En qué puedo ayudarte hoy?</div>
        </div>
        <div class="chat-input-area">
          <input type="text" id="chat-input" placeholder="Escribe tu mensaje...">
          <button id="send-btn">Enviar</button>
        </div>
      </div>

      <div class="chat-trigger">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      </div>
    `;

    this.shadowRoot.querySelector('.chat-trigger').addEventListener('click', () => this.toggleChat());
    this.shadowRoot.querySelector('#send-btn').addEventListener('click', () => this.sendMessage());
    this.shadowRoot.querySelector('#chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
  }
}

customElements.define('jepco-chat', JepcoChat);
