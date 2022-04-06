import { TextDecoder, TextEncoder } from 'util';
import * as vscode from 'vscode';
const stringify = require('json-stringify-safe');
import { flow } from 'fp-ts/lib/function';

export class SQLSerializer implements vscode.NotebookSerializer {
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

export interface IRawCellOutput {
  mime: string;
  value: any;
}
export interface IRawNotebookCell {
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

export interface IRawNotebookData {
  cells: IRawNotebookCell[]
}

export class SQLNBSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(
    context: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    var contents = new TextDecoder().decode(context);    // convert to String to make JSON object

    // // Read file contents
    // let raw: IRawNotebookData;
    // try {
    //   raw = <IRawNotebookData>JSON.parse(contents);
    // } catch {
    //   vscode.window.showErrorMessage("Unable to parse 'sqlnb' JSON");
    //   return new vscode.NotebookData([]);
    // }
    //let raw: IRawNotebookData = SQLNBSerializer.GetFileJSON(contents);
    return flow(SQLNBSerializer.GetFileJSON, SQLNBSerializer.GetNoteBookData)(contents);

    // Pass read and formatted Notebook Data to VS Code to display Notebook with saved cells

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

  private static GetFileJSON = (contents: string): IRawNotebookData => <IRawNotebookData>JSON.parse(contents);

  private static GetNoteBookData = (rawNoteBookData: IRawNotebookData) => {
    return new vscode.NotebookData(rawNoteBookData.cells.map((item) => {
      return {
        kind: item.kind,
        value: item.value,
        languageId: item.languageId,
        outputs: item.outputs ? [new vscode.NotebookCellOutput(item.outputs.map(output => vscode.NotebookCellOutputItem.json(output.value, output.mime)))] : [],
        executionSummary: item.executionSummary,
        editable: item.editable
      }
    }));
  }
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
