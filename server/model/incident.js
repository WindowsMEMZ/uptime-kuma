const { BeanModel } = require("redbean-node/dist/bean-model");
const { R } = require("redbean-node");

class Incident extends BeanModel {
    /**
     * Resolve the incident and mark it as inactive
     * @returns {Promise<void>}
     */
    async resolve() {
        await require("../incident-service").action(this.id, "resolve");
        const incident = await R.load("incident", this.id);
        this.active = incident.active;
        this.pin = incident.pin;
        this.resolved_date = incident.resolved_date;
        this.last_updated_date = incident.last_updated_date;
    }

    /**
     * Return an object that ready to parse to JSON for public
     * @returns {object} Object ready to parse
     */
    toPublicJSON() {
        return {
            id: this.id,
            style: this.style,
            title: this.title,
            content: this.content,
            pin: !!this.pin,
            active: !!this.active,
            createdDate: this.created_date,
            lastUpdatedDate: this.last_updated_date,
            status_page_id: this.status_page_id,
        };
    }
}

module.exports = Incident;
