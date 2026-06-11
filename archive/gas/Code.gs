function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Wiki付与作業')
    .addItem('作業サイドバーを開く', 'showWorkSidebar')
    .addItem('Webアプリのデプロイ手順', 'showWebAppDeployHelp')
    .addToUi();
}

/**
 * Web アプリ URL の入口（デプロイ → ウェブアプリ）
 * 設定: 実行=アクセスしているユーザー / アクセス=組織内 or Googleアカウント
 */
function doGet() {
  return createWorkHtmlOutput_('webapp');
}

function createWorkHtmlOutput_(mode) {
  var template = HtmlService.createTemplateFromFile('WorkApp');
  template.mode = mode || 'sidebar';
  template.sheetUrl = getSpreadsheetUrl_();
  return template
    .evaluate()
    .setTitle('Wiki付与 行作業')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function showWorkSidebar() {
  SpreadsheetApp.getUi().showSidebar(createWorkHtmlOutput_('sidebar'));
}

function showWebAppDeployHelp() {
  SpreadsheetApp.getUi().alert(
    'Webアプリ URL のデプロイ',
    '1. Apps Script エディタを開く\n' +
      '2. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」\n' +
      '3. 次のユーザーとして実行: アクセスしているユーザー\n' +
      '4. アクセスできるユーザー: 組織内（または Google アカウント）\n' +
      '5. デプロイ → 表示された URL をブックマーク\n\n' +
      'コード更新後は「デプロイを管理」→ 鉛筆 → 新バージョン → デプロイ',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
