/**
 * Cliente específico para API-Football
 */
class FootballApiClient {
    constructor() {
        this.baseUrl = 'https://api-football-v1.p.rapidapi.com/v3';
        this.headers = {
            'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
            'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
        };
    }

    // Métodos específicos para cada endpoint
    async getLiveMatches() {... }
    async getFixture(fixtureId) {... }
    async getFixtureStatistics(fixtureId) {... }
    async getFixtureEvents(fixtureId) {... }
}