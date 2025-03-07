/**
 * Esquema Mongoose para alertas generadas
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AlertSchema = new Schema({
    matchId: {
        type: String,
        required: true,
        ref: 'Match'
    },
    market: {
        type: String,
        required: true,
        enum: ['nextGoal', 'over05', 'over15', 'over25', 'btts', 'cornerNext10Min']
    },
    teams: {
        home: {
            id: Number,
            name: String
        },
        away: {
            id: Number,
            name: String
        }
    },
    minute: {
        type: Number,
        required: true
    },
    score: {
        home: Number,
        away: Number
    },
    prediction: {
        probability: Number,
        confidence: Number,
        expectedValue: Number
    },
    odds: {
        value: Number,
        bookmakers: [{
            name: String,
            value: Number
        }]
    },
    context: [String],
    outcome: {
        type: String,
        enum: ['pending', 'success', 'fail'],
        default: 'pending'
    },
    sentTo: [{
        userId: String,
        plan: String,
        timestamp: Date
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Índices para consultas eficientes
AlertSchema.index({ matchId: 1, market: 1 });
AlertSchema.index({ createdAt: 1 });
AlertSchema.index({ outcome: 1 });
AlertSchema.index({ 'sentTo.userId': 1 });

module.exports = AlertSchema;