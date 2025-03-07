/**
 * Modelo Mongoose para partidos
 */
const mongoose = require('mongoose');
const MatchSchema = require('../schemas/match-schema');

const Match = mongoose.model('Match', MatchSchema);

module.exports = Match;