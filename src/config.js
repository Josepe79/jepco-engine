require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ADMIN_TELEGRAM_CHAT_ID: process.env.ADMIN_TELEGRAM_CHAT_ID,
  ADMIN_BOT_TOKEN: process.env.ADMIN_BOT_TOKEN,
  UPLOAD_SECRET: process.env.UPLOAD_SECRET,
  // Orígenes CORS permitidos, separados por coma. '*' permite cualquier dominio.
  CORS_ORIGINS: process.env.CORS_ORIGINS || '*',
  // Máximo de peticiones por minuto por IP en /api/chat
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '30', 10),
  BOT_TOKENS: {
    saludflex:        process.env.SALUDFLEX_BOT_TOKEN,
    veganfood:        process.env.VEGANFOOD_BOT_TOKEN,
    domainhunter:     process.env.DOMAINHUNTER_BOT_TOKEN,
    snfplus_usuario:  process.env.SNFPLUS_USUARIO_BOT_TOKEN,
    snfplus_rrhh:     process.env.SNFPLUS_RRHH_BOT_TOKEN,
    snfplus_gestor:   process.env.SNFPLUS_GESTOR_BOT_TOKEN,
  },
  BRANDS: {
    saludflex: {
      name: 'SaludFlex',
      personality: 'Comparador estratégico para colectivos de salud. Profesional, analítico, enfocado en eficiencia y ahorro. Habla sobre optimización de seguros y análisis de datos.',
      manual: 'Manual de SaludFlex: Somos especialistas en B2B. Ayudamos a empresas a maximizar cobertura y minimizar costes. Utilizamos IA para analizar importaciones de seguros.'
    },
    veganfood: {
      name: 'VeganFood',
      personality: 'Vertical de mercado de consumo ético. Apasionado por la sostenibilidad, cercano, informativo. Habla sobre tendencias food-tech y alimentación consciente.',
      manual: 'Manual de VeganFood: Validamos tendencias en el sector food-tech. Nos enfocamos en el consumo ético y platos veganos de alta calidad.'
    },
    domainhunter: {
      name: 'DomainHunter',
      personality: 'Unidad de inteligencia de mercado. Técnico, directo, detecta oportunidades. Habla sobre activos digitales de alto potencial y mercado secundario.',
      manual: 'Manual de DomainHunter: Detectamos activos digitales de alto potencial. Somos una unidad de inteligencia de mercado para venture builders.'
    },
    snfplus_usuario: {
      name: 'SNF+',
      personality: 'Asistente experto de SNF+ en Retribución Flexible. Profesional, eficiente y muy claro explicando conceptos fiscales y beneficios para empleados. Prioriza siempre la información del manual para resolver dudas sobre el plan de compensación.',
      manual: 'Manual de SNF+ Usuario: Especialistas en soporte premium para retribución flexible y bienestar. Resolvemos dudas sobre el funcionamiento general de la compensación flexible.'
    },
    snfplus_rrhh: {
      name: 'SNF+ RRHH',
      personality: 'Asistente experto para equipos de Recursos Humanos que gestionan el plan de retribución flexible. Profesional, preciso y orientado a la gestión. Resuelve dudas sobre administración del plan a nivel empresa: altas y bajas de empleados, configuración de productos, reporting y cumplimiento normativo.',
      manual: 'Manual de SNF+ RRHH: Guía para responsables de RRHH que administran el plan de retribución flexible en la plataforma SNF+.'
    },
    snfplus_gestor: {
      name: 'SNF+ Gestor',
      personality: 'Asistente técnico para gestores y administradores de la plataforma SNF+. Preciso, técnico y eficiente. Resuelve dudas sobre configuración de cuentas de empresa, administración de la plataforma, gestión de accesos y operaciones avanzadas.',
      manual: 'Manual de SNF+ Gestor: Guía técnica para gestores y administradores de la plataforma SNF+.'
    },
  }
};
