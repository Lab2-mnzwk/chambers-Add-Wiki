function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'スプレッドシートを開けません。Config.gs の SPREADSHEET_ID を設定してください。'
    );
  }
  return active;
}

function getSpreadsheetUrl_() {
  var id = CONFIG.SPREADSHEET_ID || getSpreadsheet_().getId();
  return 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
}

function getWorkSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error('シート「' + CONFIG.SHEET_NAME + '」が見つかりません。');
  }
  return sheet;
}

function loadSheetStructure_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('sheet_structure_v1');
  if (cached) return JSON.parse(cached);

  var sheet = getWorkSheet_();
  var lastCol = sheet.getLastColumn();
  var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) {
    return String(v == null ? '' : v);
  });
  var uniqueHeaders = makeUniqueHeaders_(rawHeaders);
  var structure = {
    title: getSpreadsheet_().getName(),
    rawHeaders: rawHeaders,
    uniqueHeaders: uniqueHeaders,
    colCount: lastCol,
  };
  cache.put('sheet_structure_v1', JSON.stringify(structure), 300);
  return structure;
}

function rowValuesToMap_(rowValues, uniqueHeaders) {
  var map = {};
  for (var i = 0; i < uniqueHeaders.length; i++) {
    map[uniqueHeaders[i]] = i < rowValues.length ? rowValues[i] : '';
  }
  return map;
}

function fetchRowByNumber_(sheetRowNumber, structure) {
  var readCount = effectiveColCount_(structure.colCount, structure.uniqueHeaders);
  var sheet = getWorkSheet_();
  var rowValues = sheet
    .getRange(sheetRowNumber, 1, sheetRowNumber, readCount)
    .getValues()[0];
  return rowValuesToMap_(rowValues, structure.uniqueHeaders);
}

function loadAssignDiscordNames_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('discord_names_v1');
  if (cached) return JSON.parse(cached);

  var sheet = getSpreadsheet_().getSheetByName(CONFIG.ASSIGN_SHEET_NAME);
  if (!sheet) return [];

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colIndex = headers.indexOf(CONFIG.DISCORD_NAME_COLUMN);
  if (colIndex < 0) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, colIndex + 1, lastRow, 1).getValues();
  var names = [];
  var seen = {};
  values.forEach(function (row) {
    var name = String(row[0] == null ? '' : row[0]).trim();
    if (name && !seen[name]) {
      seen[name] = true;
      names.push(name);
    }
  });
  cache.put('discord_names_v1', JSON.stringify(names), 3600);
  return names;
}

function buildQueueSheetRows_(structure, options) {
  options = options || {};
  var indexRows = options.indexRows || CONFIG.DEFAULT_INDEX_ROWS;
  var worker = String(options.worker || '').trim();
  var queueFilter = options.queueFilter || '未担当＋自分担当';
  var skipDone = options.skipDone !== false;

  var rawHeaders = structure.rawHeaders;
  var uniqueHeaders = structure.uniqueHeaders;
  var statusUnique =
    resolveWorkStatusUnique_(rawHeaders, uniqueHeaders) || CONFIG.COL_STATUS_WORK;
  var assigneeUnique =
    uniqueHeaders.indexOf(CONFIG.COL_ASSIGNEE) >= 0 ? CONFIG.COL_ASSIGNEE : null;

  var sheet = getWorkSheet_();
  var startRow = 2;
  var endRow = Math.min(indexRows + 1, sheet.getLastRow());
  if (endRow < startRow) return [];

  function colValues_(headerName) {
    if (uniqueHeaders.indexOf(headerName) < 0) return [];
    var col = uniqueHeaders.indexOf(headerName) + 1;
    return sheet.getRange(startRow, col, endRow - startRow + 1, 1).getValues();
  }

  var renbanValues = colValues_('連番');
  var statusValues = colValues_(statusUnique);
  var assigneeValues = assigneeUnique ? colValues_(assigneeUnique) : [];

  var rows = [];
  for (var i = 0; i <= endRow - startRow; i++) {
    var sheetRowNumber = startRow + i;
    var status = statusValues[i] ? String(statusValues[i][0] || '').trim() : '';
    var assignee = assigneeValues[i]
      ? String(assigneeValues[i][0] || '').trim()
      : '';

    if (skipDone && status === CONFIG.STATUS_DONE) continue;

    if (assigneeUnique) {
      if (queueFilter === '未担当') {
        if (!isCellEmpty_(assignee)) continue;
      } else if (queueFilter === '自分担当') {
        if (assignee !== worker) continue;
      } else if (queueFilter === '未担当＋自分担当') {
        if (!isCellEmpty_(assignee) && assignee !== worker) continue;
      }
    }

    rows.push({
      sheetRowNumber: sheetRowNumber,
      renban: renbanValues[i] ? String(renbanValues[i][0] || '').trim() : '',
      status: status,
      assignee: assignee,
    });
  }
  return rows;
}

function buildWritePlan_(sheetRowNumber, structure, updates) {
  var rawHeaders = structure.rawHeaders;
  var uniqueHeaders = structure.uniqueHeaders;
  var plan = [];

  Object.keys(updates).forEach(function (uniqueName) {
    if (uniqueHeaders.indexOf(uniqueName) < 0) return;
    var colIndex = uniqueHeaders.indexOf(uniqueName) + 1;
    var rawHeader = rawHeaders[colIndex - 1];
    if (!isWritableColumn_(rawHeader, colIndex)) return;
    var letter = columnLetter_(colIndex);
    plan.push({
      cell: letter + sheetRowNumber,
      uniqueName: uniqueName,
      rawHeader: rawHeader,
      value: updates[uniqueName],
    });
  });
  return plan;
}

function executeWritePlan_(plan) {
  if (!plan.length) return;
  if (!CONFIG.ENABLE_SHEET_WRITES) {
    throw new Error('ENABLE_SHEET_WRITES=false のため書き込みできません。');
  }
  var sheet = getWorkSheet_();
  plan.forEach(function (item) {
    sheet.getRange(item.cell).setValue(item.value);
  });
}

function collectEditableUpdates_(edits, workCols, structure) {
  var rawHeaders = structure.rawHeaders;
  var uniqueHeaders = structure.uniqueHeaders;
  var headerByUnique = {};
  for (var i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  var updates = {};
  workCols.forEach(function (uniqueName) {
    if (!(uniqueName in edits)) return;
    var colIndex = uniqueHeaders.indexOf(uniqueName) + 1;
    var rawHeader = headerByUnique[uniqueName];
    if (!isInlineEditableColumn_(uniqueName, rawHeader, colIndex)) return;
    updates[uniqueName] = edits[uniqueName];
  });
  return updates;
}

/** サイドバー初期データ */
function getSidebarBootstrap() {
  var structure = loadSheetStructure_();
  return {
    spreadsheetTitle: structure.title,
    sheetName: CONFIG.SHEET_NAME,
    sheetUrl: getSpreadsheetUrl_(),
    discordNames: loadAssignDiscordNames_(),
    statusOptions: CONFIG.WORK_STATUS_OPTIONS,
    defaultIndexRows: CONFIG.DEFAULT_INDEX_ROWS,
    enableWrites: CONFIG.ENABLE_SHEET_WRITES,
  };
}

/** キュー一覧 */
function getQueueRows(options) {
  var structure = loadSheetStructure_();
  return buildQueueSheetRows_(structure, options);
}

/** 1行分の作業表データ */
function getWorkRowPayload(sheetRowNumber, options) {
  var structure = loadSheetStructure_();
  var rowByUnique = fetchRowByNumber_(sheetRowNumber, structure);
  var workCols = workDisplayColumns_(
    rowByUnique,
    structure.rawHeaders,
    structure.uniqueHeaders,
    options
  );
  workCols = ensureWorkDisplayCols_(
    workCols,
    structure.rawHeaders,
    structure.uniqueHeaders
  );
  return {
    sheetRowNumber: sheetRowNumber,
    summary: rowSummary_(rowByUnique, sheetRowNumber),
    columns: buildColumnPayload_(
      rowByUnique,
      workCols,
      structure.rawHeaders,
      structure.uniqueHeaders,
      sheetRowNumber
    ),
  };
}

/** 保存して次の行番号を返す */
function saveWorkRowAndAdvance(payload) {
  var sheetRowNumber = payload.sheetRowNumber;
  var worker = String(payload.worker || '').trim();
  var edits = payload.edits || {};
  var queueRows = payload.queueRows || [];
  var structure = loadSheetStructure_();

  var rowPayload = getWorkRowPayload(sheetRowNumber, payload.options || {});
  var workColNames = rowPayload.columns.map(function (c) {
    return c.uniqueName;
  });

  var updates = collectEditableUpdates_(edits, workColNames, structure);
  if (worker && uniqueHeadersContains_(structure, CONFIG.COL_ASSIGNEE)) {
    updates[CONFIG.COL_ASSIGNEE] = worker;
  }

  var plan = buildWritePlan_(sheetRowNumber, structure, updates);
  executeWritePlan_(plan);

  var currentIndex = -1;
  for (var i = 0; i < queueRows.length; i++) {
    if (queueRows[i].sheetRowNumber === sheetRowNumber) {
      currentIndex = i;
      break;
    }
  }
  var nextRow = null;
  if (currentIndex >= 0 && currentIndex + 1 < queueRows.length) {
    nextRow = queueRows[currentIndex + 1].sheetRowNumber;
  }

  CacheService.getScriptCache().remove('sheet_structure_v1');

  return {
    savedCells: plan.length,
    nextSheetRowNumber: nextRow,
    atEnd: nextRow === null,
  };
}

function uniqueHeadersContains_(structure, name) {
  return structure.uniqueHeaders.indexOf(name) >= 0;
}

function invalidateStructureCache() {
  CacheService.getScriptCache().remove('sheet_structure_v1');
  CacheService.getScriptCache().remove('discord_names_v1');
}
