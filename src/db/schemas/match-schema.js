/**
 * Esquema Mongoose para partidos
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MatchSchema = new Schema({
    externalId: {
        type: String,
        required: true,
        unique: true
    },
    league: {
        id: Number,
        name: String,
        country: String,
        logo: String
    },
    teams: {
        home: {
            id: Number,
            name: String,
            logo: String
        },
        away: {
            id: Number,
            name: String,
            logo: String
        }
    },
    fixture: {
        date: Date,
        status: {
            short: String,
            long: String,
            elapsed: Number
        }
    },
    goals: {
        home: Number,
        away: Number
    },
    score: {
        halftime: {
            home: Number,
            away: Number
        },
        fulltime: {
            home: Number,
            away: Number
        }
    },
    statistics: [{
        type: String,
        home: Schema.Types.Mixed,
        away: Schema.Types.Mixed
    }],
    events: [{
        time: {
            elapsed: Number,
            extra: Number
        },
        team: {
            id: Number,
            name: String
        },
        type: String,
        detail: String,
        player: {
            id: Number,
            name: String
        },
        assist: {
            id: Number,
            name: String
        }
    }],
    odds: {
        bookmakers: [{
            id: Number,
            name: String,
            markets: [{
                key: String,
                outcomes: [{
                    name: String,
                    price: Number,
                    point: Number
                }]
            }]
        }]
    },
    monitored: {
        type: Boolean,
        default: false
    },
    alertsSent: [{
        market: String,
        timestamp: Date,
        plan: String
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
MatchSchema.index({ 'fixture.date': 1 });
MatchSchema.index({ 'fixture.status.short': 1 });
MatchSchema.index({ 'teams.home.id': 1, 'teams.away.id': 1 });
MatchSchema.index({ monitored: 1 });

// Middleware pre-save
MatchSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = MatchSchema;