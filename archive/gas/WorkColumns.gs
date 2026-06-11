function isWikiTripletHidden_(rawHeader, rowByUnique, headerMap) {
  var rules = CONFIG.WIKI_TRIPLET_RULES;
  for (var r = 0; r < rules.length; r++) {
    var nameHeader = rules[r][0];
    var wikiHeader = rules[r][1];
    var okHeader = rules[r][2];
    if ([nameHeader, wikiHeader, okHeader].indexOf(rawHeader) < 0) continue;
    var nameUnique = headerMap[nameHeader];
    var wikiUnique = headerMap[wikiHeader];
    if (!nameUnique || !(nameUnique in rowByUnique)) continue;
    if (isCellEmpty_(rowByUnique[nameUnique])) continue;
    if (
      wikiUnique &&
      wikiUnique in rowByUnique &&
      isWikiDash_(rowByUnique[wikiUnique])
    ) {
      return true;
    }
  }
  return false;
}

function expandWikiTripletColumns_(
  rowByUnique,
  rawHeaders,
  uniqueHeaders,
  cols,
  lightBlueOnly
) {
  var headerMap = resolveHeaderToUnique_(rawHeaders, uniqueHeaders);
  var colSet = {};
  cols.forEach(function (c) {
    colSet[c] = true;
  });

  CONFIG.WIKI_TRIPLET_RULES.forEach(function (rule) {
    var nameHeader = rule[0];
    var wikiHeader = rule[1];
    var okHeader = rule[2];
    var nameUnique = headerMap[nameHeader];
    var wikiUnique = headerMap[wikiHeader];
    if (!nameUnique || !(nameUnique in rowByUnique)) return;
    if (!wikiUnique || !(wikiUnique in rowByUnique)) return;
    if (
      isCellEmpty_(rowByUnique[nameUnique]) ||
      !hasDisplayWikiValue_(rowByUnique[wikiUnique])
    ) {
      return;
    }
    if (rawHeaders.indexOf(okHeader) < 0) return;
    if (
      lightBlueOnly &&
      !isLightBlueWorkColumn_(okHeader, rawHeaders.indexOf(okHeader) + 1)
    ) {
      return;
    }
    var okUnique = headerMap[okHeader];
    if (okUnique && okUnique in rowByUnique) colSet[okUnique] = true;
  });

  CONFIG.WIKI_TRIPLET_RULES.forEach(function (rule) {
    var nameUnique = headerMap[rule[0]];
    var wikiUnique = headerMap[rule[1]];
    var okUnique = headerMap[rule[2]];
    if (!nameUnique || !(nameUnique in rowByUnique)) return;
    if (isCellEmpty_(rowByUnique[nameUnique])) return;
    if (!wikiUnique || !(wikiUnique in rowByUnique)) return;
    if (!isWikiDash_(rowByUnique[wikiUnique])) return;
    delete colSet[nameUnique];
    delete colSet[wikiUnique];
    if (okUnique) delete colSet[okUnique];
  });

  var leading = CONFIG.LEADING_FIXED_HEADERS.map(function (header) {
    return headerMap[header];
  }).filter(function (unique) {
    return unique && colSet[unique];
  });

  var leadingSet = {};
  leading.forEach(function (u) {
    leadingSet[u] = true;
  });

  var rest = uniqueHeaders.filter(function (unique) {
    return colSet[unique] && !leadingSet[unique];
  });

  return leading.concat(rest);
}

function workDisplayColumns_(
  rowByUnique,
  rawHeaders,
  uniqueHeaders,
  options
) {
  options = options || {};
  var showEmptyFromAc = !!options.showEmptyFromAc;
  var lightBlueOnly = options.lightBlueOnly !== false;
  var headerMap = resolveHeaderToUnique_(rawHeaders, uniqueHeaders);
  var cols = [];

  CONFIG.LEADING_FIXED_HEADERS.forEach(function (header) {
    var uniqueName = headerMap[header];
    if (uniqueName && uniqueName in rowByUnique) cols.push(uniqueName);
  });

  var startIndex = rawHeaders.indexOf(CONFIG.WORK_TABLE_START_HEADER);
  if (startIndex < 0) startIndex = rawHeaders.length;

  for (var i = startIndex; i < uniqueHeaders.length; i++) {
    var uniqueName = uniqueHeaders[i];
    var rawHeader = rawHeaders[i];
    if (!(uniqueName in rowByUnique) || cols.indexOf(uniqueName) >= 0) continue;
    if (lightBlueOnly && !isLightBlueWorkColumn_(rawHeader, i + 1)) continue;
    if (
      !showEmptyFromAc &&
      isCellEmpty_(rowByUnique[uniqueName]) &&
      !isMemoWorkColumn_(rawHeader)
    ) {
      continue;
    }
    if (isMemoWorkColumn_(rawHeader)) continue;
    if (isWikiTripletHidden_(rawHeader, rowByUnique, headerMap)) continue;
    cols.push(uniqueName);
  }

  return expandWikiTripletColumns_(
    rowByUnique,
    rawHeaders,
    uniqueHeaders,
    cols,
    lightBlueOnly
  );
}

function filterMemoDisplayColumns_(workCols, rawHeaders, uniqueHeaders) {
  var headerByUnique = {};
  for (var i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  var nonMemo = workCols.filter(function (col) {
    var raw = headerByUnique[col] || col;
    return !isMemoWorkColumn_(raw);
  });
  var active = activeWorkSections_(nonMemo, rawHeaders, uniqueHeaders);
  var filteredSet = {};
  nonMemo.forEach(function (name) {
    filteredSet[name] = true;
  });
  for (var j = 0; j < rawHeaders.length; j++) {
    var rawHeader = rawHeaders[j];
    if (!isMemoWorkColumn_(rawHeader)) continue;
    if (shouldShowMemoColumn_(rawHeader, active)) {
      filteredSet[uniqueHeaders[j]] = true;
    }
  }
  return uniqueHeaders.filter(function (name) {
    return !!filteredSet[name];
  });
}

function ensureWorkDisplayCols_(workCols, rawHeaders, uniqueHeaders) {
  var colSet = {};
  workCols.forEach(function (c) {
    colSet[c] = true;
  });
  var statusUnique = resolveWorkStatusUnique_(rawHeaders, uniqueHeaders);
  if (statusUnique) colSet[statusUnique] = true;
  var ordered = uniqueHeaders.filter(function (name) {
    return colSet[name];
  });
  return filterMemoDisplayColumns_(ordered, rawHeaders, uniqueHeaders);
}

function rowSummary_(rowByUnique, sheetRowNumber) {
  var renban = rowByUnique['連番'];
  var entity = rowByUnique['ENTITY_NAME'];
  renban = isCellEmpty_(renban) ? '' : String(renban).trim();
  entity = isCellEmpty_(entity) ? '' : String(entity).trim();
  return '行 ' + sheetRowNumber + ' | ' + renban + ' | ' + entity;
}

function buildColumnPayload_(
  rowByUnique,
  workCols,
  rawHeaders,
  uniqueHeaders,
  sheetRowNumber
) {
  var headerByUnique = {};
  for (var i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }

  return workCols.map(function (uniqueName) {
    var colIndex = uniqueHeaders.indexOf(uniqueName) + 1;
    var rawHeader = headerByUnique[uniqueName] || uniqueName;
    var value = rowByUnique[uniqueName];
    var display = isCellEmpty_(value) ? '—' : String(value);
    var inline = isInlineEditableColumn_(uniqueName, rawHeader, colIndex);
    var isStatus = isWorkStatusColumn_(rawHeader, colIndex);
    var editValue = isCellEmpty_(value) ? '' : String(value);
    if (isStatus) {
      editValue = normalizeWorkStatus_(value);
    }
    return {
      uniqueName: uniqueName,
      rawHeader: rawHeader,
      letter: columnLetter_(colIndex),
      display: display,
      value: editValue,
      inline: inline,
      isStatus: isStatus,
      isMemo: isMemoWorkColumn_(rawHeader),
      isWiki: isWikiStyleHeader_(rawHeader) && !isMemoWorkColumn_(rawHeader),
      isWikiEdit: isCorrectWikiHeader_(rawHeader),
      isLeading: CONFIG.LEADING_FIXED_HEADERS.indexOf(rawHeader) >= 0,
      isAssignee: rawHeader === CONFIG.COL_ASSIGNEE,
    };
  });
}
