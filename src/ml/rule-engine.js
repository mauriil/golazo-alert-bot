/**
 * Sistema de reglas para predicciones sin ML
 * o como complemento de ML
 */
class RuleEngine {
    constructor() {
        this.mathUtils = require('../utils/math-utils');
        this.oddsCalculator = require('../utils/odds-calculator');
    }

    // Evaluar mercado según reglas
    evaluate(market, matchData) {
        switch (market) {
            case 'nextGoal':
                return this.evaluateNextGoal(matchData);
            case 'over15':
                return this.evaluateOver15(matchData);
            // Otros mercados
            default:
                return { probability: 0.5, confidence: 0.3 };
        }
    }

    // Reglas específicas por mercado
    evaluateNextGoal(matchData) {... }
    evaluateOver15(matchData) {... }
    evaluateOver25(matchData) {... }
}