import * as GC from "@grapecity/spread-sheets";
import "@grapecity/spread-sheets-io"
import "@grapecity/spread-sheets-print"
import "@grapecity/spread-sheets-pdf"
import "@grapecity/spread-sheets-pivot-addon"
import "@grapecity/spread-sheets-shapes"
import "@grapecity/spread-sheets-resources-zh"
import "@grapecity/spread-sheets-designer-resources-cn"
import "@grapecity/spread-sheets-designer"

GC.Spread.Common.CultureManager.culture("zh-cn");
let designer, spread, ws, lockedCells = []
let userId = getUrlSearch("id")
GC.Spread.Common.CultureManager.culture("zh-cn");
designer = new GC.Spread.Sheets.Designer.Designer(document.getElementById("spread-container"));
spread = designer.getWorkbook()
buildWsConn()

function initListner() {
    let cm = spread.commandManager();
    cm.addListener('myListener', onCommandExecute)
    let sheet = spread.getActiveSheet()

    // 编辑状态处理
    // 举例：当用户张三编辑A1单元格时，其他用户的A1单元格应该处于不可编辑状态，A1被张三独占。编辑结束后，其他用户方可编辑
    // 由于同时会有多个用户编辑不同的单元格，还要考虑到此时增删行列导致锁定位置的变动，所以锁定状态比较复杂，放在服务端处理，处理完毕后向前端发消息
    // 思考：为什么不直接在前端row_change和col_change消息中处理锁定状态？
    // 回答：因为lockedCells是从后端拿的，一旦行列发生变化后，又有用户开始编辑的话，那后端记录的lockedCell就是错误的了，再同步给所有客户端就会导致所有客户端的锁定单元格状态错误
    sheet.bind(GC.Spread.Sheets.Events.EditStarting, function (e, info) {
        for (let i = 0; i < lockedCells.length; i++) {
            let cellInfo = lockedCells[i]
            if (cellInfo.row == info.row && cellInfo.col == info.col && info.sheet.name() == cellInfo.sheetName) {
                if (userId != cellInfo.userId) {
                    // 如果当前单元格不属于当前用户编辑的话，就禁止进入编辑状态，并给出提出
                    info.cancel = true
                    alert("此单元格正被其他用户编辑！")
                }
                break
            } else {
                continue
            }
        }
        // 如果EditStarting没有被cancel，证明当前用户可以编辑此单元格（或者说此单元格未锁定），则向后端同步消息
        if (!info.cancel) {
            ws.send(JSON.stringify({
                type: "start_edit",
                row: info.row,
                col: info.col,
                sheetName: info.sheet.name()
            }))
        }
    });
    sheet.bind(GC.Spread.Sheets.Events.EditEnded, function (e, info) {
        ws.send(JSON.stringify({
            type: "end_edit",
            row: info.row,
            col: info.col,
            sheetName: info.sheet.name()
        }))
    });

    sheet.bind(GC.Spread.Sheets.Events.ClipboardPasted, function (e, info) {
        console.log(info)
    });
}

function getUrlSearch(key) {
    let querys = top.location.search.split("?")[1]
    if (!querys) {
        return ""
    }
    querys = querys.split("&")
    for (let i = 0; i < querys.length; i++) {
        let kv = querys[i]
        let k = kv.split("=")[0]
        if (k == key) {
            return kv.split("=")[1]
        }
    }
    return ""
}



function buildWsConn() {
    ws = new WebSocket('ws://127.0.0.1:8001');
    ws.onopen = function () {
        ws.send(JSON.stringify({
            userId: userId,
            type: "fetch_json"
        }));
    }
    ws.onclose = function () { }
    ws.onerror = function () { }
    ws.onmessage = function (e) {
        console.log(e)
        if (!e.data) {
            return
        }
        let msg = JSON.parse(e.data)
        let commandMgr = spread.commandManager()
        let undoMgr = spread.undoManager()
        switch (msg.type) {
            // // 后端给前端返回json
            case "return_json": {
                spread.fromJSON(JSON.parse(msg.json))
                // fromJSON之后要重新绑定事件
                initListner()
                break;
            }
            // 后端向前端请求json字符串
            case "fetch_json": {
                ws.send(JSON.stringify({
                    type: "return_json",
                    to: msg.to,
                    json: JSON.stringify(spread.toJSON())
                }))
                break;
            }
            case "sync_locked_cells": {
                markLockedCells(true)
                lockedCells = msg.data
                markLockedCells()
                break;
            }
            case "direct_execute": {
                commandMgr.removeListener("myListener")
                handleEditStatus(spread.getActiveSheet(), function () {
                    let sheet = spread.getSheetFromName(msg.data.sheetName)
                    let selections = sheet.getSelections()
                    switch (msg.data.cmd) {
                        case "clipboardPaste": {
                            handlePaste(sheet, msg, commandMgr, undoMgr)
                            break
                        }
                        case "gc.spread.contextMenu.insertRows": {
                            handleInsertRow(sheet, msg)
                            break
                        }
                        case "gc.spread.contextMenu.deleteRows": {
                            handleDeleteRow(sheet, msg)
                            break
                        }
                        case "gc.spread.contextMenu.insertColumns": {
                            handleInsertCol(sheet, msg)
                            break
                        }
                        case "gc.spread.contextMenu.deleteColumns": {
                            handleDeleteCol(sheet, msg)
                            break
                        }
                        default: {
                            // 很多问题都是由range序列化引起，这里统一处理
                            Object.keys(msg.data).forEach(key => {
                                if (!Array.isArray(msg.data[key])) {
                                    return
                                }

                                let arr0 = msg.data[key][0]
                                if (!arr0) {
                                    return
                                }
                                if (Object.keys(arr0).length == 4 && arr0.row && arr0.col && arr0.rowCount && arr0.colCount) {
                                    msg.data[key] = msg.data[key].map(r => {
                                        return new GC.Spread.Sheets.Range(r.row, r.col, r.rowCount, r.colCount)
                                    })
                                }
                            })
                            commandMgr.execute(msg.data)
                            // 清除undo redo堆栈
                            undoMgr.clear()
                            sheet.clearSelection()
                            selections.forEach(r => {
                                sheet.addSelection(r.row, r.col, r.rowCount, r.colCount)
                            })
                            sheet.setActiveCell(selections[0].row, selections[0].col)
                            break
                        }

                    }
                })
                commandMgr.addListener('myListener', onCommandExecute)
                break;
            }
            default:
                break;
        }
    }
}

function handlePaste(sheet, msg, commandMgr, undoMgr) {
    sheet.suspendPaint()
    let f = msg.data.fromRanges?.[0]
    let p = msg.data.pastedRanges[0]
    if (f) {
        sheet.copyTo(f.row, f.col, p.row, p.col, f.rowCount, f.colCount, GC.Spread.Sheets.CopyToOptions.all)
    } else {
        msg.data.pastedRanges = msg.data.pastedRanges.map(r => {
            return new GC.Spread.Sheets.Range(r.row, r.col, r.rowCount, r.colCount)
        })
        commandMgr.execute(msg.data)
        undoMgr.clear()
    }
    sheet.resumePaint()
}

function handleInsertRow(sheet, msg) {
    let msgSel = msg.data.selections?.[0]
    let selectedCell = sheet.getSelections()?.[0]
    // 增加行
    sheet.addRows(msgSel.row, msgSel.rowCount)
    // 处理当前选中的单元格（插入、删除行会引起当前选中单元格位置的变化）
    if (selectedCell && selectedCell.row >= msgSel.row) {
        handleEditStatus(sheet, function () {
            sheet.clearSelection()
            sheet.addSelection(selectedCell.row + msgSel.rowCount, selectedCell.col, selectedCell.rowCount, selectedCell.colCount)
            sheet.setActiveCell(selectedCell.row + msgSel.rowCount, selectedCell.col)
        })
    }
}

function handleDeleteRow(sheet, msg) {
    let msgSel = msg.data.selections?.[0]
    let selectedCell = sheet.getSelections()?.[0]
    sheet.deleteRows(msgSel.row, msgSel.rowCount)
    // 处理当前选中的单元格（插入、删除行会引起当前选中单元格位置的变化）
    if (selectedCell && selectedCell.row >= msgSel.row) {
        handleEditStatus(sheet, function () {
            sheet.clearSelection()
            sheet.addSelection(selectedCell.row - msgSel.rowCount, selectedCell.col, selectedCell.rowCount, selectedCell.colCount)
            sheet.setActiveCell(selectedCell.row - msgSel.rowCount, selectedCell.col)
        })
    }
}

function handleInsertCol(sheet, msg) {
    let msgSel = msg.data.selections?.[0]
    let selectedCell = sheet.getSelections()?.[0]
    sheet.addColumns(msgSel.col, msgSel.colCount)
    // 处理当前选中的单元格（插入、删除行会引起当前选中单元格位置的变化）
    if (selectedCell && selectedCell.col >= msgSel.col) {
        handleEditStatus(sheet, function () {
            sheet.clearSelection()
            sheet.addSelection(selectedCell.row, selectedCell.col + msgSel.colCount, selectedCell.rowCount, selectedCell.colCount)
            sheet.setActiveCell(selectedCell.row, selectedCell.col + msgSel.colCount)
        })
    }
}

function handleDeleteCol(sheet, msg) {
    let msgSel = msg.data.selections?.[0]
    let selectedCell = sheet.getSelections()?.[0]
    sheet.deleteColumns(msgSel.col, msgSel.colCount)
    // 处理当前选中的单元格（插入、删除行会引起当前选中单元格位置的变化）
    if (selectedCell && selectedCell.col >= msgSel.col) {
        handleEditStatus(sheet, function () {
            sheet.clearSelection()
            sheet.addSelection(selectedCell.row, selectedCell.col - msgSel.colCount, selectedCell.rowCount, selectedCell.colCount)
            sheet.setActiveCell(selectedCell.row, selectedCell.col - msgSel.colCount)
        })
    }
}

// 处理单元格的编辑状态和选中状态
function handleEditStatus(sheet, callback) {
    sheet.suspendPaint()
    // 处理正在输入的单元格
    let isEditing = sheet.isEditing()
    let editText
    if (isEditing) {
        // 在清除选中之前，先把正在输入的内容保存下来
        editText = document.querySelector("div[gcuielement='gcEditingInput']").textContent
        // 结束当前编辑，并忽略已经输入的值
        sheet.endEdit(true)
    }
    
    callback && callback()
    
    if (isEditing) {
        sheet.startEdit(true, editText)
    }
    sheet.resumePaint()
}

function onCommandExecute(args) {
    if (!args.command) {
        return
    }
    if (!args.command.cmd) {
        return
    }
    spread.undoManager().clear()
    switch (args.command.cmd) {
        // 不向其他客户端同步的command类型写在这里
        case "zoom":
            return
        default:
            break
    }
    ws.send(JSON.stringify({
        type: "direct_execute",
        data: args.command
    }))
}

function LockedCell() {
    this.typeName = "LockedCell"
}
LockedCell.prototype = new GC.Spread.Sheets.CellTypes.Text()
let oldPaint = GC.Spread.Sheets.CellTypes.Text.prototype.paint
LockedCell.prototype.paint = function (context, value, x1, y1, a1, b1, style, ctx) {
    if (!context) {
        return
    }
    oldPaint.apply(this, arguments)
    context.save()
    context.fillStyle = "#f4b184"
    context.lineWidth = 3
    context.fillRect(x1, y1, a1, b1)

    context.fillStyle = "red"
    context.font = "12px Arial"
    context.fillText(this.userId + "正在编辑", x1 + a1, y1 + (b1 / 2))
    context.restore()
}

/**
 * 正在编辑中的单元格添加/删除背景色
 * flag: 标记是否清除颜色
 */

function markLockedCells(flag) {
    let sheets = {}
    spread.suspendPaint()
    lockedCells.forEach(info => {
        if (!sheets[info.sheetName]) {
            let sheet = spread.getSheetFromName(info.sheetName)
            sheets[info.sheetName] = sheet
        }
        let sheet = sheets[info.sheetName]
        if (sheet.getCellType(info.row, info.col).typeName == "1" && userId == info.userId) {
            return
        }
        let cellType = new GC.Spread.Sheets.CellTypes.Text()
        if (!flag && userId != info.userId) {
            cellType = new LockedCell()
            cellType.userId = info.userId
        }
        sheet.setCellType(info.row, info.col, cellType)
    })
    spread.resumePaint()
}