import type { Metadata } from "next";
import Link from "next/link";
import { CacheRebuildButton } from "@/components/CacheRebuildButton";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: "使い方ガイド | PJ140 Wiki付与",
  description: "PJ140 Wiki付与 作業アプリの使い方",
};

export default function GuidePage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>使い方ガイド</h1>
        <Link href="/" className={styles.backLink}>
          ← 作業画面へ戻る
        </Link>
      </div>

      <p className={styles.lead}>
        PJ140 Wiki付与の作業アプリの使い方をまとめています。担当の行を1件ずつ開き、
        Wiki 情報などを入力・保存していく作業ツールです。入力は移動操作にあわせて
        自動保存されます。
      </p>

      <div className={styles.note}>
        対象シートは <strong>第一二弾</strong> と <strong>第三弾</strong> の2つで、
        <strong>1本のキューとして通しで</strong>表示されます（第一二弾 → 第三弾の順）。
        今どちらのシートを見ているかは、行番号の表示に併記されます。
      </div>

      <nav className={styles.toc} aria-label="目次">
        <strong>目次</strong>
        <ul>
          <li><a href="#basic">1. 基本の流れ</a></li>
          <li><a href="#screen">2. 画面の見方</a></li>
          <li><a href="#buttons">3. ボタン・操作</a></li>
          <li><a href="#filter">4. 表示の絞り込み</a></li>
          <li><a href="#edit">5. 入力と自動保存</a></li>
          <li><a href="#suggest">6. 正しいWiki の候補機能</a></li>
          <li><a href="#links">7. 名称の検索リンク</a></li>
          <li><a href="#status">8. Status（状態）の種類</a></li>
          <li><a href="#memory">9. 設定と開いていた行の記憶</a></li>
          <li><a href="#login">10. ログインと権限</a></li>
          <li><a href="#trouble">11. よくある症状と対処</a></li>
          <li><a href="#speed">12. 移動が速い理由と注意点</a></li>
          <li><a href="#maintenance">13. 全キャッシュ再構築（メンテナンス）</a></li>
        </ul>
      </nav>

      <section id="basic" className={styles.section}>
        <h2 className={styles.sectionTitle}>1. 基本の流れ</h2>
        <ol className={styles.list}>
          <li>Google アカウントでログインします。</li>
          <li>
            <strong>作業者名</strong>（Discord名）を選ぶと、あなたの担当行だけが
            順番に表示されます。
          </li>
          <li>表示された行の内容を確認し、必要な箇所を入力します。</li>
          <li>
            <strong>次の行</strong>／<strong>前の行</strong>で移動します。移動の際、
            未保存の入力は<strong>自動で保存</strong>されます。
          </li>
          <li>Status を「完了」などに更新しながら、担当行を進めていきます。</li>
        </ol>
        <div className={styles.note}>
          明示的な「保存ボタン」はありません。行を移動したタイミングで保存される
          仕組みです（スプレッドシートのような操作感）。
        </div>
      </section>

      <section id="screen" className={styles.section}>
        <h2 className={styles.sectionTitle}>2. 画面の見方</h2>
        <ul className={styles.list}>
          <li>
            <strong>作業表</strong>: 中央に現在の行の各列が並びます。入力欄がある列は
            編集でき、入力欄が無い列は読み取り専用です。
          </li>
          <li>
            <strong>キュー ◯ / ◯ ・ シート名 行 ◯</strong>: 「今の位置 / 対象行の総数」と、
            <strong>どのシート（第一二弾／第三弾）の何行目か</strong>を示します。
          </li>
          <li>
            列が横に長い場合は、作業表を横スクロールできます。行を移動すると
            スクロール位置は自動で左端に戻ります。
          </li>
        </ul>
      </section>

      <section id="buttons" className={styles.section}>
        <h2 className={styles.sectionTitle}>3. ボタン・操作</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>項目</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">作業者名</th>
              <td>選んだ担当者に割り当てられた行だけを表示します。</td>
            </tr>
            <tr>
              <th scope="row">全件表示</th>
              <td>
                作業者名の選択肢にある「全件表示」を選ぶと、担当で絞らず全行を対象に
                します（表示の絞り込みは引き続き有効）。
              </td>
            </tr>
            <tr>
              <th scope="row">前の行</th>
              <td>変更を保存して前の対象行へ移動します。</td>
            </tr>
            <tr>
              <th scope="row">次の行</th>
              <td>変更を保存して次の対象行へ移動します。</td>
            </tr>
            <tr>
              <th scope="row">開く</th>
              <td>
                変更を保存して、指定したシート・行番号の行を開きます。行番号の左の
                <strong>シート選択</strong>で第一二弾／第三弾を選べます（既定は今のシート）。
              </td>
            </tr>
            <tr>
              <th scope="row">リセット</th>
              <td>今の行の入力を、読み込み時の状態に戻します（保存前の取り消し）。</td>
            </tr>
            <tr>
              <th scope="row">対象行リストを更新</th>
              <td>
                担当・Status など、表示対象行の最新状態をスプレッドシートから
                読み直します。フィルタが効いていないと感じたら実行します。
              </td>
            </tr>
            <tr>
              <th scope="row">表示中の行を再取得</th>
              <td>
                一時保存している行の内容を消します。次に開くと最新の内容を取得し直す
                ため、表示が古い・動作が重いと感じたときに使います。
              </td>
            </tr>
            <tr>
              <th scope="row">候補再構築</th>
              <td>
                正しいwiki の入力候補をシートから作り直します。更新タイミングの
                詳細は「6. 正しいWiki の候補機能」を参照してください。
              </td>
            </tr>
            <tr>
              <th scope="row">表示設定等</th>
              <td>スマホ利用時に、表示の絞り込みやテーマ等の設定を開くトグルです。</td>
            </tr>
            <tr>
              <th scope="row">？（使い方）</th>
              <td>タイトル横のボタン。操作や表示設定の簡単な説明を表示します。</td>
            </tr>
            <tr>
              <th scope="row">作業シートを開く ↗</th>
              <td>元のスプレッドシートを新しいタブで開きます。</td>
            </tr>
            <tr>
              <th scope="row">ログアウト</th>
              <td>
                サインアウトします。別の Google アカウントで入り直したいときにも
                使います。
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section id="filter" className={styles.section}>
        <h2 className={styles.sectionTitle}>4. 表示の絞り込み</h2>
        <p>
          「表示する行」「表示する列」の2つのドロップダウンで、対象と表示範囲を
          切り替えます。
        </p>

        <h3 className={styles.subTitle}>表示する行（進捗）</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>選択</th>
              <th>表示される行</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">すべて</th>
              <td>進捗で絞り込みません。</td>
            </tr>
            <tr>
              <th scope="row">完了を除く（既定）</th>
              <td>「完了」「完了（正規化変更）」以外を表示（＝未着手＋要確認）。</td>
            </tr>
            <tr>
              <th scope="row">未着手のみ</th>
              <td>「未着手」（空欄含む）の行だけを表示します。</td>
            </tr>
          </tbody>
        </table>

        <h3 className={styles.subTitle}>表示する列</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>選択</th>
              <th>表示される列</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Entity値あり</th>
              <td>名称に値がある Wiki 三つ組（名称／Wiki／正しいwiki）を表示します。</td>
            </tr>
            <tr>
              <th scope="row">要確認（DeweyIDなし・既定）</th>
              <td>
                名称に値があり、かつ DeweyID が未付与の三つ組だけを表示します
                （DeweyID 付与済み＝確認不要は除外）。日常の作業向けの既定です。
              </td>
            </tr>
            <tr>
              <th scope="row">編集（三つ組＋memo＋役割列）</th>
              <td>
                三つ組（名称／DeweyID／Wiki／正しいwiki）・memo・役割列（Action など）を
                広く表示し、自由入力で編集できるモードです。
              </td>
            </tr>
            <tr>
              <th scope="row">すべて</th>
              <td>作業対象範囲の全列をフィルタなしで表示します。</td>
            </tr>
          </tbody>
        </table>

        <div className={styles.note}>
          <strong>表示する行を変えた直後</strong>は、今の行の表示はそのまま残ります。
          <strong>次の行／前の行へ進むと</strong>、新しい絞り込みが反映されます。
        </div>
      </section>

      <section id="edit" className={styles.section}>
        <h2 className={styles.sectionTitle}>5. 入力と自動保存</h2>
        <ul className={styles.list}>
          <li>
            編集できるのは主に <strong>Status</strong>・<strong>memo</strong>・
            <strong>正しいwiki</strong> の列です（「編集（三つ組＋memo＋役割列）」モードでは
            より広範囲）。
          </li>
          <li>
            <strong>自動保存</strong>: 「前の行」「次の行」「開く」を押すと、未保存の
            変更があれば移動前に保存されます。変更が無い行では保存処理は走りません。
          </li>
          <li>
            <strong>保存に失敗した場合</strong>は基本的に移動を中止し、入力内容はそのまま
            保持されます（エラーが表示されます）。ただし、次の行への移動が特に速く
            表示された直後に限り、先に次の行が表示されてから保存が行われることが
            あります。この場合の失敗の扱いは「12. 移動が速い理由と注意点」を
            参照してください。
          </li>
          <li>
            <strong>リセット</strong>で、今の行の入力を読み込み時の値へ戻せます
            （保存前の取り消し）。
          </li>
          <li>
            DeweyID が既にある「正しいwiki」列は入力欄がなく、
            <span className={styles.tag}>DeweyIDありのため入力不要</span> と表示されます。
          </li>
          <li>
            画面を閉じる・タブを切り替える際にも、未保存があれば保存を試みます
            （通信状況によっては保存されないこともあります）。
          </li>
        </ul>
      </section>

      <section id="suggest" className={styles.section}>
        <h2 className={styles.sectionTitle}>6. 正しいWiki の候補機能</h2>
        <p>
          「正しいwiki」欄を選ぶか「候補を表示」を押すと、過去に確定した値を候補として
          表示します。候補をクリックするとその値が欄に入ります。
        </p>
        <ul className={styles.list}>
          <li>
            候補には <strong>URL</strong>、<strong>Wiki該当なし（「-」）</strong>、
            <strong>Wiki欄変更不要のため入力なし（空欄）</strong> の3種類があります。
          </li>
          <li>
            同じ名称（必要に応じて Wiki）に一致する候補を、件数の多い順に最大8件まで
            表示します。入力中の文字でさらに絞り込まれます。
          </li>
          <li>候補が無いときは「候補なし」と表示されます。</li>
          <li>
            候補は<strong>第一二弾・第三弾の両シートの実績を合算</strong>して表示されます
            （片方のシートで確定した正解が、もう片方でも候補に出ます）。
          </li>
          <li>
            <strong>自分が保存した内容はすぐに候補へ反映</strong>されます。ただし
            他の方が保存した分は、アプリの動作環境の都合で反映に時間差が出ることが
            あります（決まった周期での自動更新はありません）。候補が古い・見当たら
            ないと感じたら、<strong>候補再構築</strong>ボタンで最新の内容に
            更新してください。
          </li>
        </ul>
      </section>

      <section id="links" className={styles.section}>
        <h2 className={styles.sectionTitle}>7. 名称の検索リンク</h2>
        <p>名称セルには、確認に使える2つの Google 検索リンクがあります。</p>
        <ul className={styles.list}>
          <li>
            <strong>名称↗</strong>: 名称の文字列そのものが検索リンクになっています
            （末尾の ↗ でリンクと分かるようにしています）。
          </li>
          <li>
            <strong>文脈検索↗</strong>: 名称の下に表示され、出来事名と名称を組み合わせた
            文（例: 出来事「◯◯」における「△△」に該当するWiki記事は？）で検索します。
          </li>
        </ul>
      </section>

      <section id="status" className={styles.section}>
        <h2 className={styles.sectionTitle}>8. Status（状態）の種類</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Status</th>
              <th>意味</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">未着手</th>
              <td>まだ着手していない行（空欄も未着手として扱います）。</td>
            </tr>
            <tr>
              <th scope="row">完了</th>
              <td>作業が完了した行。</td>
            </tr>
            <tr>
              <th scope="row">完了（正規化変更）</th>
              <td>正規化の変更を伴って完了した行。完了扱いです。</td>
            </tr>
            <tr>
              <th scope="row">要確認</th>
              <td>判断に迷う・確認が必要な行。完了ではありません。</td>
            </tr>
          </tbody>
        </table>
        <p>
          「完了を除く」は<strong>完了</strong>と<strong>完了（正規化変更）</strong>の
          両方を除外します。
        </p>
      </section>

      <section id="memory" className={styles.section}>
        <h2 className={styles.sectionTitle}>9. 設定と開いていた行の記憶</h2>
        <ul className={styles.list}>
          <li>
            表示の絞り込みなどの<strong>設定は、使っているブラウザ内に保存</strong>され
            ます（端末・ブラウザごと。サーバーには個人設定を保存しません）。
          </li>
          <li>
            <strong>最後に開いていた行</strong>も記憶し、次回開いたときに、その行が
            今の対象（絞り込み）に含まれていれば復元します。含まれない場合は先頭行から
            始まります。
          </li>
          <li>
            <strong>シークレットウィンドウ</strong>では、ウィンドウを全て閉じると記憶が
            消えます。開き直すと設定は既定（「完了を除く」など）に戻ります。
          </li>
        </ul>
      </section>

      <section id="login" className={styles.section}>
        <h2 className={styles.sectionTitle}>10. ログインと権限</h2>
        <ul className={styles.list}>
          <li>
            作業シートへのアクセスは、ログインした Google アカウントの権限を使います。
          </li>
          <li>
            ログインの有効期限が切れた場合は、ログイン画面が表示されます。もう一度
            ログインしてください。
          </li>
          <li>
            <strong>権限に関するエラー</strong>が出た場合は、一度ログアウトして
            再ログインをお試しください。サインイン中はエラー時でも
            <strong>ログアウトボタンは常に表示</strong>されるので、別アカウントへの
            切り替えもできます。解決しない場合はご連絡ください。
          </li>
        </ul>
      </section>

      <section id="trouble" className={styles.section}>
        <h2 className={styles.sectionTitle}>11. よくある症状と対処</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>症状</th>
              <th>対処</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">絞り込みが効いていない気がする</th>
              <td>
                外部でシートを直接編集した後などにキャッシュが古くなることがあります。
                「対象行リストを更新」を実行してください。
              </td>
            </tr>
            <tr>
              <th scope="row">正しいwiki の候補が出ない／古い</th>
              <td>「候補再構築」で候補を作り直してください。</td>
            </tr>
            <tr>
              <th scope="row">表示中の行の内容が古い・動作が重い</th>
              <td>「表示中の行を再取得」を実行し、行を開き直してください。</td>
            </tr>
            <tr>
              <th scope="row">フィルタを変えたのに今の行が変わらない</th>
              <td>
                仕様です。切替直後は今の行が残り、次の行／前の行へ進むと反映されます。
              </td>
            </tr>
            <tr>
              <th scope="row">エラーでログアウトできない</th>
              <td>
                サインイン中はエラー時でもログアウトボタンが表示されます。そこから
                ログアウト→再ログインしてください。
              </td>
            </tr>
            <tr>
              <th scope="row">前回の続きから始まらない</th>
              <td>
                最後の行が今の絞り込みに含まれない（完了・対象外など）と、先頭行から
                始まります。シークレットウィンドウでは設定が既定に戻る点も影響します。
              </td>
            </tr>
            <tr>
              <th scope="row">次の行に進んだ後で保存失敗の通知が出た</th>
              <td>
                通知に書かれた行番号を「開く」で開き直し、入力し直してください。
                詳しくは「12. 移動が速い理由と注意点」を参照してください。
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section id="speed" className={styles.section}>
        <h2 className={styles.sectionTitle}>12. 移動が速い理由と注意点</h2>
        <p>
          「次の行」「前の行」は、できるだけ待ち時間なく表示されるように、
          手元に既にあるデータを信頼して先に表示する仕組みになっています。
          その分、以下の点に注意してください。
        </p>

        <h3 className={styles.subTitle}>保存の完了より先に次の行が表示されることがある</h3>
        <ul className={styles.list}>
          <li>
            入力後に「次の行」へ進むと、保存の完了を待たずに次の行が先に
            表示される場合があります。保存が完了すると「N セルを保存しました」が
            短く表示されて自動的に消えます。この表示が出れば保存済みです。
          </li>
          <li>
            まれに保存が失敗すると、<strong>次の行を表示した直後であれば</strong>
            元の行と入力内容へ自動的に戻り、エラーが表示されます（次の行で
            続けて入力していた内容は失われます）。
          </li>
          <li>
            <strong>既にさらに先へ進んでいた場合</strong>は表示は戻らず、
            「行◯◯の保存に失敗しました。該当行を開き直して再入力してください」
            という通知だけが出ます。この場合はその行を「開く」で開き直し、
            入力し直してください。
          </li>
        </ul>

        <h3 className={styles.subTitle}>表示中の内容が最新でない場合がある</h3>
        <ul className={styles.list}>
          <li>
            Status・担当者は移動のたびに最新を確認していますが、それ以外の列は
            直前に見た内容や一時保存した内容がそのまま表示されることがあります。
          </li>
          <li>
            通常は自分の担当行を1人で編集するため問題になりませんが、同じ行を
            他の方も編集している場合は、表示が古いことがあります。触っていない
            列を古い値で上書きすることはありませんが、最新の内容を確認したい
            ときは「対象行リストを更新」または「表示中の行を再取得」を実行して
            ください。
          </li>
        </ul>

        <h3 className={styles.subTitle}>アクセスが集中しているときは一時的に遅くなる</h3>
        <p>
          スプレッドシート側の混雑（アクセス集中）を検知すると、待ち時間を
          短く切ってから再試行する仕組みになっています。混雑が続いている間は
          エラーが表示されることがありますが、少し時間を置いてから同じ操作を
          やり直してください。
        </p>
      </section>

      <section id="maintenance" className={styles.section}>
        <h2 className={styles.sectionTitle}>
          13. 全キャッシュ再構築（メンテナンス）
        </h2>
        <p>
          「対象行リストを更新」「表示中の行を再取得」「候補再構築」を行っても状況が
          改善しない場合の最終手段です。アプリが一時保存している情報（対象行・
          行データ・入力候補のすべて）を消して作り直します。通常の作業では
          使いません。
        </p>
        <div className={styles.note}>
          実行すると作り直しが完了するまで少し時間がかかります。実行後は
          作業画面を再読み込みしてください。
        </div>
        <CacheRebuildButton />
      </section>

      <Link href="/" className={styles.backLink}>
        ← 作業画面へ戻る
      </Link>
    </div>
  );
}
