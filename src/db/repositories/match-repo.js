/**
 * Repositorio para operaciones con partidos
 * Abstrae las operaciones de base de datos
 */
const Match = require('../models/match');
const mongoClient = require('../mongo-client');
const localDb = require('../local-db');
const logger = require('../../utils/logger');

class MatchRepository {
    constructor() {
        this.useLocalDb = false;
    }

    // Inicializar repo
    async initialize() {
        try {
            await mongoClient.connect();
        } catch (error) {
            logger.error('Fallback a base de datos local para partidos');
            this.useLocalDb = true;
        }
    }

    // Obtener partidos en vivo
    async getLiveMatches() {
        if (this.useLocalDb) {
            return localDb.find('matches', { 'fixture.status.short': { $in: ['1H', '2H', 'HT'] } });
        }

        return Match.find({
            'fixture.status.short': { $in: ['1H', '2H', 'HT'] }
        }).exec();
    }

    // Obtener partido por ID
    async getMatchById(id) {
        if (this.useLocalDb) {
            return localDb.findOne('matches', { externalId: id });
        }

        return Match.findOne({ externalId: id }).exec();
    }

    // Guardar partido
    async saveMatch(matchData) {
        if (this.useLocalDb) {
            return localDb.upsert('matches',
                { externalId: matchData.externalId },
                matchData
            );
        }

        return Match.findOneAndUpdate(
            { externalId: matchData.externalId },
            matchData,
            { upsert: true, new: true }
        ).exec();
    }

    // Actualizar estadísticas de partido
    async updateMatchStats(matchId, statistics) {
        if (this.useLocalDb) {
            const match = await localDb.findOne('matches', { externalId: matchId });
            if (match) {
                match.statistics = statistics;
                match.updatedAt = new Date();
                return localDb.update('matches', { externalId: matchId }, match);
            }
            return null;
        }

        return Match.findOneAndUpdate(
            { externalId: matchId },
            {
                $set: {
                    statistics: statistics,
                    updatedAt: new Date()
                }
            },
            { new: true }
        ).exec();
    }

    // Marcar partido como monitorizado
    async setMatchMonitored(matchId, isMonitored = true) {
        if (this.useLocalDb) {
            return localDb.update('matches',
                { externalId: matchId },
                { $set: { monitored: isMonitored } }
            );
        }

        return Match.findOneAndUpdate(
            { externalId: matchId },
            { $set: { monitored: isMonitored } },
            { new: true }
        ).exec();
    }

    // Registrar alerta enviada
    async registerAlertSent(matchId, market, plan) {
        const alert = {
            market,
            timestamp: new Date(),
            plan
        };

        if (this.useLocalDb) {
            const match = await localDb.findOne('matches', { externalId: matchId });
            if (match) {
                match.alertsSent = match.alertsSent || [];
                match.alertsSent.push(alert);
                return localDb.update('matches', { externalId: matchId }, match);
            }
            return null;
        }

        return Match.findOneAndUpdate(
            { externalId: matchId },
            { $push: { alertsSent: alert } },
            { new: true }
        ).exec();
    }

    // Obtener partidos en monitoreo
    async getMonitoredMatches() {
        if (this.useLocalDb) {
            return localDb.find('matches', { monitored: true });
        }

        return Match.find({ monitored: true }).exec();
    }
}

module.exports = new MatchRepository();