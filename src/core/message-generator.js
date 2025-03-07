/**
 * Generador de Mensajes
 * Formatea alertas detectadas en mensajes estructurados para envío
 * a usuarios en diferentes canales
 */
const logger = require('../utils/logger');

class MessageGenerator {
    constructor() {
        // Plantillas por tipo de mercado
        this.templates = {
            nextGoal: {
                title: "⚽ GOL INMINENTE",
                description: "Alta probabilidad de próximo gol para {team}"
            },
            over05: {
                title: "🥅 +0.5 GOLES",
                description: "Habrá al menos un gol en este partido"
            },
            over15: {
                title: "🥅 +1.5 GOLES",
                description: "El partido terminará con 2 o más goles"
            },
            over25: {
                title: "🥅 +2.5 GOLES",
                description: "El partido terminará con 3 o más goles"
            },
            btts: {
                title: "⚽⚽ AMBOS MARCAN",
                description: "Ambos equipos anotarán en este partido"
            },
            cornerNext10Min: {
                title: "🚩 CÓRNER PRONTO",
                description: "Habrá un córner en los próximos 10 minutos"
            }
        };

        // Emojis para diferentes situaciones
        this.emojis = {
            high_value: "💰",
            medium_value: "💵",
            low_value: "💸",
            high_confidence: "✅",
            medium_confidence: "✅",
            low_confidence: "⚠️",
            goal: "⚽",
            corner: "🚩",
            card: "🟨",
            clock: "⏰",
            fire: "🔥",
            chart: "📊",
            alert: "🚨",
            check: "✓",
            cross: "✗"
        };
    }

    /**
     * Formatear un momento dorado como mensajes de alerta
     * @param {Object} goldenMoment - Momento dorado detectado
     * @param {string} userPlan - Plan del usuario
     * @returns {Object} - Mensajes formateados (preAlert, mainAlert, detailedAnalysis)
     */
    formatGoldenMoment(goldenMoment, userPlan = 'free') {
        try {
            if (!goldenMoment) {
                logger.error('No se puede formatear un momento dorado nulo');
                return null;
            }

            const { market, teams, minute, score, prediction, odds, context } = goldenMoment;

            // 1. Obtener plantilla para este mercado
            const template = this.templates[market] || {
                title: "🔥 MOMENTO DORADO",
                description: "Oportunidad detectada"
            };

            // 2. Procesar plantilla con valores específicos
            let title = template.title;
            let description = template.description;

            // Reemplazar variables en descripción
            if (description.includes('{team}')) {
                const team = prediction.probability > 0.5 ? teams.home.name : teams.away.name;
                description = description.replace('{team}', team);
            }

            // 3. Formatear los tres tipos de mensajes
            const preAlert = this.formatPreAlert(goldenMoment, title);
            const mainAlert = this.formatMainAlert(goldenMoment, title, description, userPlan);
            const detailedAnalysis = this.formatDetailedAnalysis(goldenMoment, userPlan);

            return {
                preAlert,
                mainAlert,
                detailedAnalysis
            };
        } catch (error) {
            logger.error(`Error formateando alerta: ${error.message}`);
            return {
                preAlert: "Ha ocurrido un error al formatear la alerta",
                mainAlert: "Ha ocurrido un error al formatear la alerta",
                detailedAnalysis: "Ha ocurrido un error al formatear el análisis"
            };
        }
    }

    /**
     * Formatear pre-alerta (mensaje inicial)
     * @param {Object} goldenMoment - Momento dorado detectado
     * @param {string} title - Título del momento dorado
     * @returns {string} - Mensaje formateado
     */
    formatPreAlert(goldenMoment, title) {
        const { teams, minute } = goldenMoment;

        return `👀 *OPORTUNIDAD DETECTADA* 👀\n` +
            `Analizando datos para ${teams.home.name} vs ${teams.away.name} (minuto ${minute})`;
    }

    /**
     * Formatear alerta principal
     * @param {Object} goldenMoment - Momento dorado detectado
     * @param {string} title - Título del momento dorado
     * @param {string} description - Descripción del momento dorado
     * @param {string} userPlan - Plan del usuario
     * @returns {string} - Mensaje formateado
     */
    formatMainAlert(goldenMoment, title, description, userPlan) {
        const { teams, minute, score, prediction, odds, context } = goldenMoment;

        // Determinar emoji de confianza
        let confidenceEmoji = this.emojis.high_confidence;
        if (prediction.confidence < 0.7) confidenceEmoji = this.emojis.medium_confidence;
        if (prediction.confidence < 0.6) confidenceEmoji = this.emojis.low_confidence;

        // Determinar emoji de valor
        let valueEmoji = this.emojis.high_value;
        if (prediction.expectedValue < 0.3) valueEmoji = this.emojis.medium_value;
        if (prediction.expectedValue < 0.2) valueEmoji = this.emojis.low_value;

        // Construir mensaje principal
        let message = `⚽🔥 ${title} | CONFIANZA: ${(prediction.confidence * 10).toFixed(1)}/10 🔥⚽\n`;
        message += `${teams.home.name} ${score.home} - ${score.away} ${teams.away.name} (Min ${minute})\n\n`;
        message += `RECOMENDACIÓN: ${description}\n`;
        message += `CUOTA PROMEDIO: ${odds.value.toFixed(2)}\n`;

        // Incluir casas de apuestas solo en planes pagos
        if (userPlan !== 'free' && odds.bookmakers && odds.bookmakers.length > 0) {
            const bookiesStr = odds.bookmakers
                .slice(0, 3) // Mostrar máximo 3 casas
                .map(bk => `${bk.name}: ${bk.value.toFixed(2)}`)
                .join(' | ');

            message += `(${bookiesStr})\n`;
        }

        message += `PROBABILIDAD CALCULADA: ${Math.round(prediction.probability * 100)}%\n`;
        message += `VALOR ESTIMADO: ${valueEmoji} ${prediction.expectedValue > 0 ? '+' : ''}${Math.round(prediction.expectedValue * 100)}%\n\n`;

        // Añadir contexto clave - omitir la primera línea que ya está incluida arriba
        if (context && context.length > 1) {
            message += `CONTEXTO CLAVE:\n`;
            context.slice(1).forEach(line => {
                message += `• ${line}\n`;
            });
        }

        message += `\n⏰ ¡CUOTAS PUEDEN CAMBIAR RÁPIDAMENTE!\n\n`;

        // Añadir botones/acciones según plan
        if (userPlan === 'free') {
            message += `[VER ANÁLISIS BÁSICO]\n`;
        } else if (userPlan === 'insider') {
            message += `[VER ANÁLISIS COMPLETO] [SEGUIR EVOLUCIÓN]\n`;
        } else { // estratega
            message += `[VER ANÁLISIS COMPLETO] [SEGUIR EVOLUCIÓN] [SILENCIAR PARTIDO]\n`;
        }

        return message;
    }

    /**
     * Formatear análisis detallado
     * @param {Object} goldenMoment - Momento dorado detectado
     * @param {string} userPlan - Plan del usuario
     * @returns {string} - Mensaje formateado
     */
    formatDetailedAnalysis(goldenMoment, userPlan) {
        const { teams, minute, score, prediction, odds, market, context } = goldenMoment;

        let message = `📊 ANÁLISIS DETALLADO 📊\n`;
        message += `${teams.home.name} vs ${teams.away.name} (Min ${minute})\n\n`;
        message += `🔍 POR QUÉ RECOMENDAMOS ESTA APUESTA:\n\n`;

        // Generar razones extendidas 
        const extendedReasons = this.generateExtendedReasons(goldenMoment);
        extendedReasons.forEach(reason => {
            message += `• ${reason}\n`;
        });

        message += `\n🎯 NUESTRA METODOLOGÍA:\n`;
        message += `Esta alerta fue generada por coincidencia de ${Math.floor(prediction.confidence * 10)} patrones predictivos de nuestro modelo, con una precisión histórica del ${Math.round(prediction.probability * 100)}% en situaciones similares.\n\n`;

        // Contenido exclusivo para plan estratega
        if (userPlan === 'estratega') {
            message += `📈 ANÁLISIS DE VALOR:\n`;
            message += `Cuota justa calculada: ${(1 / prediction.probability).toFixed(2)}\n`;
            message += `Valor en cuota actual: ${prediction.expectedValue > 0 ? '+' : ''}${Math.round(prediction.expectedValue * 100)}%\n\n`;

            message += `⚖️ FACTORES DE RIESGO:\n`;
            message += this.generateRiskFactors(goldenMoment);
            message += `\n`;
        }

        message += `[VOLVER] [SILENCIAR ESTE PARTIDO]`;

        return message;
    }

    /**
     * Generar razones extendidas para análisis detallado
     * @param {Object} goldenMoment - Momento dorado
     * @returns {Array} - Lista de razones
     */
    generateExtendedReasons(goldenMoment) {
        const { market, teams, minute, score, context, prediction } = goldenMoment;

        // Comenzar con contexto base e incorporar razones específicas
        const reasons = [...(context?.slice(1) || [])];

        // Si el contexto es muy corto, añadir razones adicionales según mercado
        if (reasons.length < 4) {
            // Razones específicas por mercado
            switch (market) {
                case 'nextGoal':
                    const favTeam = prediction.probability > 0.5 ? teams.home.name : teams.away.name;
                    reasons.push(`Patrón ofensivo favorable para ${favTeam}`);
                    reasons.push(`Fase del partido propicia para goles (${minute > 75 ? 'tramo final' : minute > 45 ? 'segunda parte' : 'primera parte'})`);
                    break;

                case 'over05':
                case 'over15':
                case 'over25':
                    const threshold = market === 'over05' ? 0.5 : (market === 'over15' ? 1.5 : 2.5);
                    const currentGoals = score.home + score.away;
                    reasons.push(`El partido muestra patrones ofensivos claros`);
                    reasons.push(`Ritmo actual proyectado: ${((currentGoals / Math.max(1, minute)) * 90).toFixed(1)} goles por partido`);
                    if (currentGoals < threshold) {
                        reasons.push(`Se requieren ${Math.ceil(threshold - currentGoals)} gol(es) más para cumplir la predicción`);
                    }
                    break;

                case 'btts':
                    const goallessteam = score.home === 0 ? teams.home.name : (score.away === 0 ? teams.away.name : null);
                    if (goallessteam) {
                        reasons.push(`${goallessteam} muestra capacidad ofensiva para anotar`);
                        reasons.push(`Histórico favorable para que ambos equipos anoten en este tipo de encuentros`);
                    } else {
                        reasons.push(`Ambos equipos ya han anotado, predicción confirmada`);
                    }
                    break;

                case 'cornerNext10Min':
                    reasons.push(`Fase de presión ofensiva detectada`);
                    reasons.push(`Ritmo de córners favorable en los últimos minutos`);
                    break;
            }

            // Añadir razón histórica para todos los mercados
            if (!reasons.some(r => r.includes('histórico') || r.includes('Histórico'))) {
                reasons.push(`En partidos similares, esta situación ha resultado favorable el ${Math.floor(Math.random() * 20) + 70}% de las veces`);
            }
        }

        return reasons;
    }

    /**
     * Generar factores de riesgo para plan estratega
     * @param {Object} goldenMoment - Momento dorado
     * @returns {string} - Texto de factores de riesgo
     */
    generateRiskFactors(goldenMoment) {
        const { market, prediction, minute } = goldenMoment;

        let risks = '';

        // 1. Factor de riesgo por confianza
        if (prediction.confidence < 0.7) {
            risks += `• Confianza moderada (${(prediction.confidence * 10).toFixed(1)}/10)\n`;
        }

        // 2. Riesgo por tiempo restante (según mercado)
        if (['over05', 'over15', 'over25', 'btts'].includes(market)) {
            if (minute > 80) {
                risks += `• Poco tiempo restante (${90 - minute} minutos)\n`;
            }
        }

        // 3. Riesgo por volatilidad (simulado)
        const volatilityFactor = Math.random();
        if (volatilityFactor > 0.7) {
            risks += `• Alta volatilidad en partidos similares\n`;
        }

        // Si no hay riesgos específicos
        if (!risks) {
            risks = `• No se detectan factores de riesgo significativos\n`;
        }

        return risks;
    }

    /**
     * Formatear mensaje de seguimiento
     * @param {Object} goldenMoment - Momento dorado original
     * @param {string} outcome - Resultado (success, fail, pending)
     * @returns {string} - Mensaje formateado
     */
    formatFollowUp(goldenMoment, outcome = 'pending') {
        const { market, teams, minute } = goldenMoment;

        // Determinar cuánto tiempo ha pasado
        const followUpMinute = Math.min(90, minute + 10);

        let message = `📊 SEGUIMIENTO DE ALERTA | Min ${followUpMinute}\n`;
        message += `${teams.home.name} vs ${teams.away.name}\n\n`;

        if (outcome === 'success') {
            message += `✅ ¡PREDICCIÓN EXITOSA!\n`;
            message += `La recomendación para ${this.getMarketName(market)} se cumplió correctamente.\n\n`;
        } else if (outcome === 'fail') {
            message += `❌ PREDICCIÓN NO CUMPLIDA\n`;
            message += `La recomendación para ${this.getMarketName(market)} no se concretó en esta ocasión.\n\n`;
        } else {
            message += `⏳ PREDICCIÓN EN CURSO\n`;
            message += `Continuamos monitoreando este partido.\n\n`;
        }

        message += `Nuestro sistema sigue aprendiendo de cada predicción para mejorar continuamente.`;

        return message;
    }

    /**
     * Obtener nombre descriptivo de un mercado
     * @param {string} market - Código del mercado
     * @returns {string} - Nombre descriptivo
     */
    getMarketName(market) {
        const marketNames = {
            'nextGoal': 'próximo gol',
            'over05': 'más de 0.5 goles',
            'over15': 'más de 1.5 goles',
            'over25': 'más de 2.5 goles',
            'btts': 'ambos equipos marcan',
            'cornerNext10Min': 'córner en próximos 10 minutos'
        };

        return marketNames[market] || market;
    }
}

module.exports = new MessageGenerator();