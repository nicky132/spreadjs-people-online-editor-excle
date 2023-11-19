let ws = require("nodejs-websocket")
let fs = require("fs")

let lockedCells = []
let server = ws.createServer(function (conn) {
    conn.on('text', function (str) {
        // 记录客户端userId
        let msg = JSON.parse(str)
        if (!conn.userId && msg.userId) {
            conn.userId = msg.userId
        }
        if (msg.type == 'fetch_json') {
            // 如果客户端请求json文件，那么分两种情况
            if (server.connections.length == 1) {
                // 第一种情况：此客户端为当前唯一的连接，直接返回服务器保存的json
                let json = fs.readFileSync("template.json", "utf8")
                sendMsg(conn, {
                    type: "return_json",
                    json: json
                })
                syncLockStatus(conn)
            } else if (server.connections.length > 1) {
                // 第二种情况：当前存在多于一个的连接，那么需要从其他客户端（注意，是其他客户端的连接，不是当前连接）拉取最新的json保存在服务端，并返回给当前客户
                // 需要注意的是，这里有一次通信操作，服务端需要向客户端询问最新的json，收到客户端回信后，消息会走到下面的“return_json”里
                for (let i = 0; i < server.connections.length; i++) {
                    let c = server.connections[i]
                    if (c.userId != conn.userId) {
                        // 这里的fetch_json是服务端向客户端fetch，而不是客户端向服务端fetch
                        sendMsg(c, {
                            type: "fetch_json",
                            to: conn.userId // 记录是谁请求，收到回信的时候要用
                        })
                        break
                    }
                }
            }
        } else if (msg.type == 'return_json') {
            fs.writeFileSync("template.json", msg.json, "utf8")
            // 如果有to，就证明收到json之后要转发给另一个客户端
            if (msg.to) {
                server.connections.forEach(c => {
                    if (c.userId == msg.to) {
                        sendMsg(c, {
                            type: "return_json",
                            json: msg.json
                        })
                        syncLockStatus(c)
                    }
                })
            }
        } else if (msg.type == "start_edit") {
            // 有用户开始编辑了，锁定单元格位置
            lockedCells.push({
                userId: conn.userId,
                row: msg.row,
                col: msg.col,
                sheetName: msg.sheetName
            })
            // 向客户端同步锁定状态单元格的信息
            syncLockStatus()
        } else if (msg.type == "end_edit") {
            // 用户结束编辑了，取消锁定
            lockedCells = lockedCells.filter(v => {
                return v.row != msg.row || v.col != msg.col
            })
            syncLockStatus()
        } else if (msg.type == "direct_execute") {
            switch (msg.data.cmd) {
                case "gc.spread.contextMenu.insertRows": {
                    lockedCells.forEach(info => {
                        if (info.row >= msg.data.row) {
                            info.row = info.row + msg.data.count
                        }
                    })
                    syncLockStatus()
                    break
                }
                case "gc.spread.contextMenu.deleteRows": {
                    lockedCells.forEach(info => {
                        if (info.row >= msg.data.row) {
                            info.row = info.row - msg.data.count
                        }
                    })
                    syncLockStatus()
                    break
                }
                case "gc.spread.contextMenu.insertColumns": {
                    lockedCells.forEach(info => {
                        if (info.col >= msg.data.col) {
                            info.col = info.col + msg.data.count
                        }
                    })
                    syncLockStatus()
                    break
                }
                case "gc.spread.contextMenu.deleteColumns": {
                    lockedCells.forEach(info => {
                        if (info.col >= msg.data.col) {
                            info.col = info.col - msg.data.count
                        }
                    })
                    syncLockStatus()
                    break
                }
            }
            // 直接执行命令，此类命令无需做修改，就可以对其他客户端同步，且不会造成别的影响
            sendMsgToOthers(conn, msg)
        }
    })
    conn.on('close', function () {
        lockedCells = lockedCells.filter(v => {
            return v.userId != conn.userId
        })
    })
    conn.on('error', function () { })
}).listen(8001)

// 像除了conn的其他连接发送消息
function sendMsgToOthers(conn, msg) {
    server.connections.forEach(c => {
        // 仅向其他客户端发送消息
        if (c.userId != conn.userId) {
            c.send(JSON.stringify(msg))
        }
    })
}

function sendMsg(conn, msg) {
    conn.send(JSON.stringify(msg))
}

// 向所有客户端同步锁定状态
function syncLockStatus(c) {
    if (c) {
        sendMsg(c, {
            type: "sync_locked_cells",
            data: lockedCells
        })
        return
    }
    server.connections.forEach(c => {
        sendMsg(c, {
            type: "sync_locked_cells",
            data: lockedCells
        })
    })
}