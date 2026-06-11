/**
 * Streamlit app.py と同じ定数・列ルール（Wiki付与 行作業サイドバー）
 */
var CONFIG = {
  /** Web アプリ URL から開くときに必須（app.py と同じ ID） */
  SPREADSHEET_ID: '1jGba1Vnzjlvf6dNj6hqVRYoPEkcJVkeU1dND-vnThrY',
  SHEET_NAME: 'wiki付与作業シート（第一弾）',
  ASSIGN_SHEET_NAME: 'アサイン',
  DISCORD_NAME_COLUMN: 'discord名',
  COL_STATUS_WORK: 'Status.1',
  COL_ASSIGNEE: 'Assignee',
  ENABLE_SHEET_WRITES: true,
  STATUS_NOT_STARTED: '未着手',
  STATUS_DONE: '完了',
  STATUS_NEEDS_REVIEW: '要確認',
  WORK_STATUS_OPTIONS: ['未着手', '完了', '要確認'],
  WORK_TABLE_START_HEADER: 'ENTITY_NAME',
  WORK_STATUS_COL_LETTER: 'FG',
  WORK_ASSIGNEE_COL_LETTER: 'FH',
  DEFAULT_INDEX_ROWS: 10000,
  WRITE_DENYLIST_COL_LETTERS: ['AE'],
  LEADING_FIXED_HEADERS: [
    'head_page',
    'tail_page',
    '通し番号',
    '連番',
    'STARTDATE',
    'ENDDATE',
  ],
  MEMO_WORK_HEADERS: [
    'Agent_memo',
    'Place_memo',
    'Patient-Theme_memo',
    'Territory_memo',
  ],
  MEMO_SECTION_BY_HEADER: {
    Agent_memo: 'Agent',
    Place_memo: 'Place',
    'Patient-Theme_memo': 'Patient-Theme',
    Territory_memo: 'Territory',
  },
};

function buildLightBlueWorkHeaders_() {
  var names = {
    Agent_memo: true,
    Place_memo: true,
    'Patient-Theme_memo': true,
    Territory_memo: true,
  };
  var i;
  for (i = 1; i <= 5; i++) names['A_name' + i] = true;
  for (i = 6; i <= 8; i++) names['A_' + i] = true;
  for (i = 1; i <= 8; i++) {
    names['A_Wiki' + i] = true;
    names['A_正しいwiki' + i] = true;
  }
  for (i = 1; i <= 5; i++) {
    names['Pl_name' + i] = true;
    names['Pl_Wiki' + i] = true;
    names['Pl_正しいwiki' + i] = true;
  }
  for (i = 1; i <= 7; i++) {
    names['P-T_' + i] = true;
    names['P-T_Wiki' + i] = true;
    names['P-T_正しいwiki' + i] = true;
  }
  for (i = 1; i <= 9; i++) {
    names['Te_name' + i] = true;
    names['Te_Wiki' + i] = true;
    names['Te_正しいwiki' + i] = true;
  }
  return names;
}

CONFIG.LIGHT_BLUE_WORK_HEADERS = buildLightBlueWorkHeaders_();

function buildWikiTripletRules_() {
  var rules = [];
  var i;
  for (i = 1; i <= 5; i++) {
    rules.push(['A_name' + i, 'A_Wiki' + i, 'A_正しいwiki' + i]);
  }
  for (i = 6; i <= 8; i++) {
    rules.push(['A_' + i, 'A_Wiki' + i, 'A_正しいwiki' + i]);
  }
  for (i = 1; i <= 5; i++) {
    rules.push(['Pl_name' + i, 'Pl_Wiki' + i, 'Pl_正しいwiki' + i]);
  }
  for (i = 1; i <= 7; i++) {
    rules.push(['P-T_' + i, 'P-T_Wiki' + i, 'P-T_正しいwiki' + i]);
  }
  for (i = 1; i <= 9; i++) {
    rules.push(['Te_name' + i, 'Te_Wiki' + i, 'Te_正しいwiki' + i]);
  }
  return rules;
}

CONFIG.WIKI_TRIPLET_RULES = buildWikiTripletRules_();
