import * as vscode from 'vscode';
import { SQLNotebookConnections } from './connections';
import { connectToDatabase, deleteConnectionConfiguration } from './commands';
import { Pool } from './driver';
import { activateFormProvider } from './form';
import { SqlLspClient } from './lsp';
import { SQLNBSerializer, SQLSerializer } from './serializer';
import { SQLNBNotebookController, SQLNotebookController } from './controller';

export const notebookType = 'sql-notebook';
export const sqlnbnotebookType = 'sqlnb-notebook';
export const storageKey = 'sqlnotebook-connections';

export const globalConnPool: { pool: Pool | null } = {
  pool: null,
};

export const globalLspClient = new SqlLspClient();

export function activate(context: vscode.ExtensionContext) {
  console.log("Extension activated123")

  context.subscriptions.push(
    vscode.   workspace.registerNotebookSerializer(
      notebookType,
      new SQLSerializer()
    )
  );

  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      sqlnbnotebookType,
      new SQLNBSerializer()
    )
  );

  context.subscriptions.push(new SQLNotebookController());
  context.subscriptions.push(new SQLNBNotebookController())


  const connectionsSidepanel = new SQLNotebookConnections(context);

  vscode.window.registerTreeDataProvider(
    'sqlnotebook-connections',
    connectionsSidepanel
  );

  activateFormProvider(context);

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
