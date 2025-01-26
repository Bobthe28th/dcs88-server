const net = require('net');
const { dbuser, dbpass } = require('../config.json');
const mysql = require('mysql2');
const crypto = require('crypto');

const con = mysql.createConnection({
    host: "localhost",
    user: dbuser,
    password: dbpass,
    database: "dcs88"
});

con.connect(function(err) {
    if (err) throw err;
    console.log("Connected to database");
});

async function getUserByPass(pass) {
    return new Promise((resolve, reject) => {
        con.query("SELECT * FROM users WHERE pass = ?", [pass], function(err, result) {
            if (err) throw err;
            if (result.length > 0) resolve(result[0]);
            else resolve(undefined);
        });
    });
}

const activeSessions = {};
const clientLoginAttempts = {};
const maxAttempts = 5;
const cooldownTime = 3 * 60 * 1000;

const server = net.createServer((socket) => {
    console.log(`Client connection at ${socket.remoteAddress} from port ${socket.remotePort}`);

    socket.setKeepAlive(true, 5000);
    socket.on('data', async (data) => {
        console.log(`Client data: ${data}`);
        const clientIp = socket.remoteAddress;
        const jsonData = JSON.parse(data);
        if (jsonData) {
            if (jsonData.type) {
                switch (jsonData.type) {
                    case "loginAttempt":
                        if (jsonData.pass) {
                            let loginAttempts = clientLoginAttempts[clientIp];
                            if (loginAttempts && loginAttempts.cooldownTime > Date.now()) {
                                socket.write(JSON.stringify({type: "loginResponse", response: `Too many failed attempts, try again in ${Math.ceil((loginAttempts.cooldownTime - Date.now()) / 1000)} seconds`}))
                            } else {
                                let user = await getUserByPass(jsonData.pass);
                                if (user) {
                                    delete clientLoginAttempts[clientIp];
                                    const token = crypto.randomBytes(16).toString('hex');
                                    activeSessions[clientIp] = {token, loginTime: Date.now()};
                                    socket.write(JSON.stringify({type: "loginResponse", response: "Success!", token: token}));
                                } else {
                                    if (loginAttempts && loginAttempts.lastAttempt + cooldownTime <= Date.now()) {
                                        loginAttempts.attempts = 0;
                                    }
                                    if (!loginAttempts) {
                                        clientLoginAttempts[clientIp] = { attempts: 0, lastAttempt: 0, cooldownTime: 0 };
                                        loginAttempts = clientLoginAttempts[clientIp];
                                    }
                                    loginAttempts.lastAttempt = Date.now();
                                    loginAttempts.attempts++;
                                    if (loginAttempts.attempts >= maxAttempts) {
                                        loginAttempts.cooldownTime = Date.now() + cooldownTime;
                                        socket.write(JSON.stringify({type: "loginResponse", response: `Too many failed attempts. You are now on cooldown for ${cooldownTime / 1000} seconds`}));
                                    } else {
                                        socket.write(JSON.stringify({type: "loginResponse", response: `Invalid login attempt, ${maxAttempts - clientLoginAttempts[clientIp].attempts} attempts remaining`}));
                                    }
                                }
                            }
                        } else {
                            socket.write(JSON.stringify({type: "loginResponse", response: "Bad data from client"}));
                        }
                        break;
                }
            }
        }
    });
    socket.on('end', () => {
        console.log('Client disconnected');
        if (activeSessions[socket.remoteAddress]) {
            delete activeSessions[socket.remoteAddress];
        }
    });
    socket.on('error', (error) => {
        console.log('Client error ' + error);
        if (activeSessions[socket.remoteAddress]) {
            delete activeSessions[socket.remoteAddress];
        }
    });
});

server.listen(3500, () => {
    console.log("Server listening to 3500");
});