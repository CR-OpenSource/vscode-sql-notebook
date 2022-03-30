import { TextDecoder, TextEncoder } from 'util';
import * as vscode from 'vscode';
import { SQLNotebookConnections } from './connections';
import { connectToDatabase, deleteConnectionConfiguration } from './commands';
import { Pool, ExecutionResult, TabularResult, Row } from './driver';
import { activateFormProvider } from './form';
import { SqlLspClient } from './lsp';
const stringify = require('json-stringify-safe');

const notebookType = 'sql-notebook';
const customNotebookType = 'sqln-notebook';
export const storageKey = 'sqlnotebook-connections';

export const globalConnPool: { pool: Pool | null } = {
  pool: null,
};

export const globalLspClient = new SqlLspClient();

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      notebookType,
      new SQLSerializer()
    )
  );
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      customNotebookType,
      new CustomSQLSerializer()
    )
  );
  const connectionsSidepanel = new SQLNotebookConnections(context);
  vscode.window.registerTreeDataProvider(
    'sqlnotebook-connections',
    connectionsSidepanel
  );

  activateFormProvider(context);

  context.subscriptions.push(new SQLNotebookController());
  context.subscriptions.push(new CustomSQLNotebookController());

  vscode.commands.registerCommand(
    'sqlnotebook.deleteConnectionConfiguration',
    deleteConnectionConfiguration(context, connectionsSidepanel)
  );

  vscode.commands.registerCommand('sqlnotebook.refreshConnectionPanel', () => {
    connectionsSidepanel.refresh();
  });
  vscode.commands.registerCommand(
    'sqlnotebook.connect',
    connectToDatabase(context, connectionsSidepanel)
  );
}

export function deactivate() { }
interface IRawCellOutput {
  mime: string;
  value: any;
}
interface IRawNotebookCell {
  languageId: string;
  value: string;
  kind: vscode.NotebookCellKind;
  editable?: boolean;
  outputs: IRawCellOutput[];
  executionSummary?: {
    timing?: {
      startTime: number,
      endTime: number;
    },
    executionOrder?: number,
    success?: boolean
  }
}

interface IRawNotebookData {
  cells: IRawNotebookCell[]
}


class CustomSQLSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(
    context: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    var contents = new TextDecoder().decode(context);    // convert to String to make JSON object

    // Read file contents
    let raw: IRawNotebookData;
    try {
      raw = <IRawNotebookData>JSON.parse(contents);
    } catch {
      vscode.window.showErrorMessage("Unable to parse 'sqlnb' JSON");
      return new vscode.NotebookData([]);
    }

    // Pass read and formatted Notebook Data to VS Code to display Notebook with saved cells
    return new vscode.NotebookData(raw.cells.map((item) => {
      return {
        kind: item.kind,
        value: item.value,
        languageId: item.languageId,
        outputs: item.outputs ? [new vscode.NotebookCellOutput(item.outputs.map(output => vscode.NotebookCellOutputItem.text(output.value, output.mime)))] : [],
        executionSummary: item.executionSummary,
        editable: item.editable
      }
    }));
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    // Give a string of all the data to save and VS Code will handle the rest 
    return new TextEncoder().encode(stringify({
      cells: data.cells.map(cell => {

        return {
          kind: cell.kind,
          languageId: cell.languageId,
          value: cell.value,
          outputs: this.ConvertToRawCellOutput(cell),
          executionSummary: cell.executionSummary,
          editable: true
        }
      })
    }));
  }


  // function to take output renderer data to a format to save to the file
  private ConvertToRawCellOutput(cell: vscode.NotebookCellData): IRawCellOutput[] {
    let result: IRawCellOutput[] = [];
    for (let output of cell.outputs ?? []) {
      for (let item of output.items) {
        let outputContents = '';
        try {
          outputContents = new TextDecoder().decode(item.data);
        } catch {
          //TODO handle this better
        }

        try {
          let outputData = JSON.parse(outputContents);
          result.push({ mime: item.mime, value: outputData });
        } catch {
          result.push({ mime: item.mime, value: outputContents });
        }
      }
    }
    return result;
  }

}

class SQLSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(
    context: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    const str = new TextDecoder().decode(context);
    const blocks = splitSqlBlocks(str);

    const cells = blocks.map((query) => {
      const isMarkdown = query.startsWith('/*markdown') && query.endsWith('*/');
      if (isMarkdown) {
        const lines = query.split('\n');
        const innerMarkdown =
          lines.length > 2 ? lines.slice(1, lines.length - 1).join('\n') : '';
        return new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          innerMarkdown,
          'markdown'
        );
      }

      return new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        query,
        'sql'
      );
    });
    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    return new TextEncoder().encode(
      data.cells
        .map(({ value, kind }) =>
          kind === vscode.NotebookCellKind.Code
            ? value
            : `/*markdown\n${value}\n*/`
        )
        .join('\n\n')
    );
  }
}

class CustomSQLNotebookController {
  readonly controllerId = 'sqlnb-notebook-executor';
  readonly notebookType = customNotebookType;
  readonly label = 'SQL Notebook';
  readonly supportedLanguages = ['sql'];

  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;

  constructor() {
    this._controller = vscode.notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._execute.bind(this);
  }

  private _execute(
    cells: vscode.NotebookCell[],
    _notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): void {
    for (let cell of cells) {
      this.doExecution(cell);
    }
  }

  dispose() {
    globalConnPool.pool?.end();
  }

  private async doExecution(cell: vscode.NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    // this is a sql block
    const rawQuery = cell.document.getText();
    if (!globalConnPool.pool) {
      writeErr(
        execution,
        'No active connection found. Configure database connections in the SQL Notebook sidepanel.'
      );
      return;
    }
    const conn = await globalConnPool.pool.getConnection();
    execution.token.onCancellationRequested(() => {
      console.debug('got cancellation request');
      (async () => {
        conn.release();
        conn.destroy();
        writeErr(execution, 'Query cancelled');
      })();
    });

    console.debug('executing query', { query: rawQuery });
    let result: ExecutionResult;
    try {
      result = await conn.query(rawQuery);
      console.debug('sql query completed', result);
      conn.release();
    } catch (err) {
      console.debug('sql query failed', err);
      // @ts-ignore
      writeErr(execution, err.message);
      conn.release();
      return;
    }

    if (typeof result === 'string') {
      execution.replaceOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(result, "text"),
        ])
      );
      execution.end(true, Date.now());
      return;
    }

    if (
      result.length === 0 ||
      (result.length === 1 && result[0].length === 0)
    ) {
      execution.replaceOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text("Query success", "text"),
        ])
      );
      execution.end(true, Date.now());
      return;
    }
    const tables = result.map((r) => resultToMarkdownTable(r));
    writeSuccessSQLNB(execution, result, 'application/json');
  }
}
class SQLNotebookController {
  readonly controllerId = 'sql-notebook-executor';
  readonly notebookType = notebookType;
  readonly label = 'SQL Notebook';
  readonly supportedLanguages = ['sql'];

  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;

  constructor() {
    this._controller = vscode.notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._execute.bind(this);
  }

  private _execute(
    cells: vscode.NotebookCell[],
    _notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): void {
    for (let cell of cells) {
      this.doExecution(cell);
    }
  }

  dispose() {
    globalConnPool.pool?.end();
  }

  private async doExecution(cell: vscode.NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    // this is a sql block
    const rawQuery = cell.document.getText();
    if (!globalConnPool.pool) {
      writeErr(
        execution,
        'No active connection found. Configure database connections in the SQL Notebook sidepanel.'
      );
      return;
    }
    const conn = await globalConnPool.pool.getConnection();
    execution.token.onCancellationRequested(() => {
      console.debug('got cancellation request');
      (async () => {
        conn.release();
        conn.destroy();
        writeErr(execution, 'Query cancelled');
      })();
    });

    console.debug('executing query', { query: rawQuery });
    let result: ExecutionResult;
    try {
      result = await conn.query(rawQuery);
      console.debug('sql query completed', result);
      conn.release();
    } catch (err) {
      console.debug('sql query failed', err);
      // @ts-ignore
      writeErr(execution, err.message);
      conn.release();
      return;
    }

    if (typeof result === 'string') {
      writeSuccessSQL(execution, result);
      return;
    }

    if (
      result.length === 0 ||
      (result.length === 1 && result[0].length === 0)
    ) {
      writeSuccessSQL(execution, 'Successfully executed query');
      return;
    }
    const tables = result.map((r) => resultToMarkdownTable(r));
    writeSuccessSQL(execution, tables, 'text/markdown');
  }
}

function resultToMarkdownTable(result: TabularResult): string {
  if (result.length < 1) {
    return '*Empty Results Table*';
  }

  if (result.length > 20) {
    result = result.slice(0, 20);
    result.push(
      Object.fromEntries(Object.entries(result).map((pair) => [pair[0], '...']))
    );
  }
  return `${markdownHeader(result[0])}\n${result
    .map((r) => markdownRow(r))
    .join('\n')}`;
}

function escapeNewline(a: string | number | null): string | number | null {
  if (typeof a === 'string') {
    return a.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  }
  return a;
}

function markdownRow(row: Row): string {
  const middle = Object.entries(row)
    .map((pair) => pair[1])
    .map(escapeNewline)
    .join(' | ');
  return `| ${middle} |`;
}

function markdownHeader(obj: Row): string {
  const keys = Object.keys(obj).join(' | ');
  const divider = Object.keys(obj)
    .map(() => '--')
    .join(' | ');
  return `| ${keys} |\n| ${divider} |`;
}

function writeErr(execution: vscode.NotebookCellExecution, err: string) {
  execution.replaceOutput([
    new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(err)]),
  ]);
  execution.end(false, Date.now());
}

function writeSuccessSQLNB(
  execution: vscode.NotebookCellExecution,
  result: ExecutionResult | ExecutionResult[],
  mimeType?: string
) {
  const items = result.length == 0 ? [result] : result;
  execution.replaceOutput(
    items.map(
      (item) =>
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.json(item, mimeType),
        ])
    )
  );
  execution.end(true, Date.now());
}

function writeSuccessSQL(
  execution: vscode.NotebookCellExecution,
  text: string | string[],
  mimeType?: string
) {
  const items = typeof text === 'string' ? [text] : text;
  execution.replaceOutput(
    items.map(
      (item) =>
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(item, mimeType),
        ])
    )
  );
  execution.end(true, Date.now());
}




function splitSqlBlocks(raw: string): string[] {
  const blocks = [];
  for (const block of raw.split('\n\n')) {
    if (block.trim().length > 0) {
      blocks.push(block);
      continue;
    }
    if (blocks.length < 1) {
      continue;
    }
    blocks[blocks.length - 1] += '\n\n';
  }
  return blocks;
}
