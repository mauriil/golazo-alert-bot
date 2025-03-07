/**
 * Base de datos local simplificada
 * usando archivos JSON
 */
class LocalDatabase {
    constructor() {
        this.fs = require('fs');
        this.path = require('path');
        this.dataDir = this.path.join(__dirname, '../../data-storage');

        // Asegurar que existe directorio
        if (!this.fs.existsSync(this.dataDir)) {
            this.fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Cargar colecciones
        this.collections = {};
        this.loadCollections();
    }

    // Cargar todas las colecciones
    loadCollections() {
        this.loadCollection('teams');
        this.loadCollection('matches');
        this.loadCollection('alerts');
        this.loadCollection('h2h');
    }

    // Cargar colección específica
    loadCollection(name) {
        const filePath = this.path.join(this.dataDir, `${name}.json`);

        if (!this.fs.existsSync(filePath)) {
            this.fs.writeFileSync(filePath, JSON.stringify([]));
        }

        try {
            this.collections[name] = JSON.parse(
                this.fs.readFileSync(filePath, 'utf8')
            );
        } catch (error) {
            console.error(`Error cargando ${name}:`, error);
            this.collections[name] = [];
        }
    }

    // Métodos CRUD
    findOne(collection, query) {... }
    find(collection, query) {... }
    insert(collection, document) {... }
    update(collection, query, update) {... }

    // Guardar en disco
    saveCollection(name) {... }
}

module.exports = new LocalDatabase();