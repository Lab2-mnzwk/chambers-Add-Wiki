function columnLetter_(colIndex) {
  var letter = '';
  var n = colIndex;
  while (n > 0) {
    var rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function columnIndexFromLetter_(letter) {
  var n = 0;
  for (var i = 0; i < letter.length; i++) {
    n = n * 26 + (letter.charCodeAt(i) - 64);
  }
  return n;
}

function isCellEmpty_(value) {
  if (value === null || value === undefined) return true;
  return String(value).trim() === '';
}

function normalizeWorkStatus_(value) {
  var val = String(value == null ? '' : value).trim();
  if (!val) return CONFIG.STATUS_NOT_STARTED;
  if (CONFIG.WORK_STATUS_OPTIONS.indexOf(val) >= 0) return val;
  return CONFIG.STATUS_NOT_STARTED;
}

function isWikiDash_(value) {
  return String(value).trim() === '-';
}

function hasDisplayWikiValue_(value) {
  return !isCellEmpty_(value) && !isWikiDash_(value);
}

function isMemoWorkColumn_(rawHeader) {
  return (
    CONFIG.MEMO_WORK_HEADERS.indexOf(rawHeader) >= 0 ||
    rawHeader.slice(-5) === '_memo'
  );
}

function isWorkStatusColumn_(rawHeader, colIndex) {
  return (
    columnLetter_(colIndex) === CONFIG.WORK_STATUS_COL_LETTER &&
    rawHeader === 'Status'
  );
}

function isCorrectWikiHeader_(rawHeader) {
  return rawHeader.indexOf('正しいwiki') >= 0;
}

function isLightBlueWorkColumn_(rawHeader, colIndex) {
  var letter = columnLetter_(colIndex);
  if (letter === CONFIG.WORK_STATUS_COL_LETTER && rawHeader === 'Status') {
    return true;
  }
  if (letter === CONFIG.WORK_ASSIGNEE_COL_LETTER && rawHeader === CONFIG.COL_ASSIGNEE) {
    return true;
  }
  return !!CONFIG.LIGHT_BLUE_WORK_HEADERS[rawHeader];
}

function isWritableColumn_(rawHeader, colIndex) {
  var letter = columnLetter_(colIndex);
  if (CONFIG.WRITE_DENYLIST_COL_LETTERS.indexOf(letter) >= 0) return false;
  if (isWorkStatusColumn_(rawHeader, colIndex)) return true;
  return (
    !!CONFIG.LIGHT_BLUE_WORK_HEADERS[rawHeader] ||
    rawHeader === CONFIG.COL_ASSIGNEE
  );
}

function isInlineEditableColumn_(uniqueName, rawHeader, colIndex) {
  if (isWorkStatusColumn_(rawHeader, colIndex)) return true;
  if (isMemoWorkColumn_(rawHeader) || isCorrectWikiHeader_(rawHeader)) {
    return isWritableColumn_(rawHeader, colIndex);
  }
  return false;
}

function isWikiStyleHeader_(header) {
  return !!CONFIG.LIGHT_BLUE_WORK_HEADERS[header];
}

function makeUniqueHeaders_(headers) {
  var seen = {};
  var unique = [];
  headers.forEach(function (header) {
    var name = header || '(空列名)';
    if (!seen[name]) {
      seen[name] = 0;
      unique.push(name);
      return;
    }
    seen[name] += 1;
    unique.push(name + '.' + seen[name]);
  });
  return unique;
}

function resolveHeaderToUnique_(rawHeaders, uniqueHeaders) {
  var mapping = {};
  for (var i = 0; i < rawHeaders.length; i++) {
    var raw = rawHeaders[i];
    if (!(raw in mapping)) mapping[raw] = uniqueHeaders[i];
  }
  return mapping;
}

function sectionForWorkRawHeader_(rawHeader) {
  if (rawHeader.indexOf('Pl_') === 0) return 'Place';
  if (rawHeader.indexOf('P-T_') === 0) return 'Patient-Theme';
  if (rawHeader.indexOf('Te_') === 0) return 'Territory';
  if (
    rawHeader.indexOf('A_name') === 0 ||
    rawHeader.indexOf('A_Wiki') === 0 ||
    rawHeader.indexOf('A_正しいwiki') === 0 ||
    rawHeader === 'A_6' ||
    rawHeader === 'A_7' ||
    rawHeader === 'A_8'
  ) {
    return 'Agent';
  }
  return null;
}

function activeWorkSections_(workCols, rawHeaders, uniqueHeaders) {
  var headerByUnique = {};
  for (var i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  var sections = {};
  workCols.forEach(function (colName) {
    var rawHeader = headerByUnique[colName] || colName;
    if (isMemoWorkColumn_(rawHeader)) return;
    var section = sectionForWorkRawHeader_(rawHeader);
    if (section) sections[section] = true;
  });
  return sections;
}

function shouldShowMemoColumn_(rawHeader, activeSections) {
  var section = CONFIG.MEMO_SECTION_BY_HEADER[rawHeader];
  if (!section) return false;
  return !!activeSections[section];
}

function resolveWorkStatusUnique_(rawHeaders, uniqueHeaders) {
  for (var i = 0; i < rawHeaders.length; i++) {
    if (
      columnLetter_(i + 1) === CONFIG.WORK_STATUS_COL_LETTER &&
      rawHeaders[i] === 'Status'
    ) {
      return uniqueHeaders[i];
    }
  }
  for (var j = 0; j < uniqueHeaders.length; j++) {
    if (uniqueHeaders[j] === CONFIG.COL_STATUS_WORK) return uniqueHeaders[j];
  }
  return null;
}

function effectiveColCount_(colCount, uniqueHeaders) {
  var maxIndex = colCount;
  [CONFIG.WORK_STATUS_COL_LETTER, CONFIG.WORK_ASSIGNEE_COL_LETTER].forEach(
    function (letter) {
      var idx = columnIndexFromLetter_(letter);
      if (idx > maxIndex) maxIndex = idx;
    }
  );
  return Math.max(colCount, maxIndex, uniqueHeaders.length);
}
