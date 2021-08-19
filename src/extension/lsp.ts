import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import * as path from 'path';

export interface LspConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  driver: SqlsDriver;
}

export type SqlsDriver = 'mysql' | 'postgresql' | 'mysql8' | 'sqlight3'; // TODO: complete

export const binDir = path.join(__filename, '..', '..', '..', 'bin');

export class SqlLspClient {
  private client: LanguageClient | null;
  constructor() {
    this.client = null;
  }
  start(config: LspConfig) {
    let serverOptions: ServerOptions = {
      command: path.join(binDir, 'sqls-linux-amd64'),
      args: [],
    };

    let clientOptions: LanguageClientOptions = {
      documentSelector: [
        { language: 'sql', },
      ],
      initializationOptions: {
        connectionConfig: {
          driver: config.driver,
          user: config.user,
          passwd: config.password,

          host: config.host,
          port: config.port,

          dbName: config.database,

          proto: 'tcp',
        },
      },
      outputChannel: vscode.window.createOutputChannel('sqls'),
    };

    this.client = new LanguageClient('sqls', serverOptions, clientOptions);
    this.client.start();
  }
  async stop() {
    await this.client?.stop();
  }
}
