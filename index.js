const cheerio = require('cheerio');
const {inspect} = require('util');
const fetch = require("node-fetch");
const express = require('express')
const Prometheus = require('prom-client')

const app = express()
const port = process.env.PORT || 3001
const metricsInterval = Prometheus.collectDefaultMetrics()

const pv_watt = new Prometheus.Gauge({
    name: 'pv_watt',
    help: 'Watt gesamt',
    labelNames: ['part'],
})

const pv_spannung = new Prometheus.Gauge({
    name: 'pv_spannung',
    help: 'Volt gesamt',
    labelNames: ['part'],
})

const pv_strom = new Prometheus.Gauge({
    name: 'pv_strom',
    help: 'Ampere gesamt',
    labelNames: ['part'],
})

const pv_heute = new Prometheus.Gauge({
    name: 'pv_heute',
    help: 'Watt heute gesamt',
})

let statistics = {
    watt: "0",
    status: "Aus",
    StringEins: {
        spannung: "0",
        strom: "0",
    },
    StringZwei: {
        spannung: "0",
        strom: "0",
    },
    tagesenergie: "0",
};

async function update() {
    try {
        statistics = await getStats();
        pv_watt.set({part: "total"}, Number(statistics.watt));
        pv_watt.set({part: "s1"}, Number(statistics.StringEins.spannung) * Number(statistics.StringEins.strom));
        pv_watt.set({part: "s2"}, Number(statistics.StringZwei.spannung) * Number(statistics.StringZwei.strom));
        pv_spannung.set({part: "s1"}, Number(statistics.StringEins.spannung));
        pv_spannung.set({part: "s2"}, Number(statistics.StringZwei.spannung));
        pv_strom.set({part: "s1"}, Number(statistics.StringEins.strom));
        pv_strom.set({part: "s2"}, Number(statistics.StringZwei.strom));

        pv_heute.set(Number(statistics.tagesenergie) * 1000);

        console.log(new Date().toLocaleString() + " >> " + inspect(statistics));

    }catch (e) {
        console.log(JSON.stringify(e));
        console.log("quitting");
        // added because of weird behaviour, the inverter kept timing out until the program restarted.
        process.exit(1);
    }
}

async function getStats() {
    let resp = await fetch("http://192.168.178.200/index.fhtml", {
        "headers": {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            "accept-language": "de-DE,de;q=0.9,en-DE;q=0.8,en;q=0.7,en-US;q=0.6,eu;q=0.5",
            "authorization": "censored",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "upgrade-insecure-requests": "1"
        },
        "referrer": "http://192.168.178.200/Info.fhtml",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": null,
        "method": "GET",
        "mode": "cors"
    });
    let resptxt = await resp.text();

    return parsePanel(resptxt.toString());
}

function resolvePath(page, paths) {
    for (let value of Object.keys(paths)) {
        if (typeof paths[value] === "string") {
            let m = page(paths[value]);
            paths[value] = m[0].children[0].data.replace(/[\n\s]+/gm, "").replace("xxx", "0");
        } else {
            paths[value] = resolvePath(page, paths[value]);
        }
    }
    return paths;
}

function parsePanel(pagesrc) {
    let fc = pagesrc.replace(/\r\n/g, '\n');
    let page = cheerio.load(fc);

    let values = {
        watt: "body > form > font > table:nth-child(2) > tbody > tr:nth-child(4) > td:nth-child(3)",
        status: "body > form > font > table:nth-child(2) > tbody > tr:nth-child(8) > td:nth-child(3)",
        StringEins: {
            spannung: "body > form > font > table:nth-child(2) > tbody > tr:nth-child(14) > td:nth-child(3)",
            strom: "body > form > font > table:nth-child(2) > tbody > tr:nth-child(16) > td:nth-child(3)",
        },
        StringZwei: {
            spannung: "body > form > font > table:nth-child(2) > tbody > tr:nth-child(19) > td:nth-child(3)",
            strom: "body > form > font > table:nth-child(2) > tbody > tr:nth-child(21) > td:nth-child(3)",
        },
        tagesenergie: "body > form > font > table:nth-child(2) > tbody > tr:nth-child(6) > td:nth-child(6)",

    };

    return resolvePath(page, values);
}

app.get('/', (req, res, next) => {
    res.send("running");

    next();
})

app.get('/pv', async (req, res, next) => {
    await res.json(await getStats());
    next();
})

app.get('/metrics', (req, res) => {
    res.set('Content-Type', Prometheus.register.contentType)
    res.end(Prometheus.register.metrics())
})
app.get('/state', (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.end(statistics.status);
})

app.use((err, req, res, next) => {
    res.statusCode = 500
    // Do not expose your error in production
    res.json({error: err.message})
    next()
})

const server = app.listen(port, () => {
    console.log(`App listening on port ${port}!`)
})

process.on('SIGTERM', () => {
    clearInterval(metricsInterval)

    server.close((err) => {
        if (err) {
            console.error(err)
            process.exit(1)
        }

        process.exit(0)
    })
});

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

(async ()=>{
    while(true){
        update(); // dont await
        await sleep(10_000);
    }
})()