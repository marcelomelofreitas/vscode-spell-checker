import {
    LanguageClient, LanguageClientOptions, ServerOptions, TransportKind,
    ForkOptions
} from 'vscode-languageclient';

import * as vscode from 'vscode';

import {
    CSpellUserSettings,
    GetConfigurationForDocumentResult,
    NotifyServerMethods,
    RequestMethods,
    RequestMethodConstants,
    SplitTextIntoWordsResult,
} from '../server';
import * as Settings from '../settings';

import * as LanguageIds from '../settings/languageIds';
import { Maybe, uniqueFilter, supportedSchemes, setOfSupportedSchemes } from '../util';

// The debug options for the server
const debugExecArgv = ['--nolazy', '--inspect=60048'];

const diagnosticCollectionName = 'cSpell';

export interface ServerResponseIsSpellCheckEnabled {
    languageEnabled?: boolean;
    fileEnabled?: boolean;
}

const methodNames: RequestMethodConstants = {
    isSpellCheckEnabled: 'isSpellCheckEnabled',
    getConfigurationForDocument: 'getConfigurationForDocument',
    splitTextIntoWords: 'splitTextIntoWords',
};


export class CSpellClient {

    readonly client: LanguageClient;
    readonly import: Set<string> = new Set();

    /**
     * @param: {string} module -- absolute path to the server module.
     */
    constructor(module: string, languageIds: string[]) {
        const enabledLanguageIds = Settings.getScopedSettingFromVSConfig('enabledLanguageIds', Settings.Scopes.Workspace);
        const allowedSchemas = Settings.getScopedSettingFromVSConfig('allowedSchemas', Settings.Scopes.Workspace) || supportedSchemes;
        setOfSupportedSchemes.clear();
        allowedSchemas.forEach(schema => setOfSupportedSchemes.add(schema));

        const uniqueLangIds = languageIds
            .concat(enabledLanguageIds || [])
            .concat(LanguageIds.languageIds)
            .filter(uniqueFilter());
        const documentSelector = allowedSchemas
            .map(schema => uniqueLangIds.map(language => ({ language, schema })))
            .reduce( (a, b) => a.concat(b));
        // Options to control the language client
        const clientOptions: LanguageClientOptions = {
            documentSelector,
            diagnosticCollectionName,
            synchronize: {
                // Synchronize the setting section 'spellChecker' to the server
                configurationSection: ['cSpell', 'search']
            }
        };

        const execArgv = this.calcServerArgs();
        const options: ForkOptions = { execArgv };
        // The debug options for the server
        const debugOptions: ForkOptions = { execArgv: [...execArgv, ...debugExecArgv] };

        // If the extension is launched in debug mode the debug server options are use
        // Otherwise the run options are used
        const serverOptions: ServerOptions = {
            run : { module, transport: TransportKind.ipc, options },
            debug: { module, transport: TransportKind.ipc, options: debugOptions }
        };

        // Create the language client and start the client.
        this.client = new LanguageClient('cspell', 'Code Spell Checker', serverOptions, clientOptions);
        this.client.registerProposedFeatures();
    }

    public needsStart() {
        return this.client.needsStart();
    }

    public needsStop() {
        return this.client.needsStop();
    }

    public start() {
        return this.client.start();
    }

    public isSpellCheckEnabled(document: vscode.TextDocument): Thenable<ServerResponseIsSpellCheckEnabled> {
        const { uri, languageId = '' } = document;

        if (!uri || !languageId) {
            return Promise.resolve({});
        }

        return this.client.onReady().then(() => this.sendRequest(
            methodNames.isSpellCheckEnabled,
            { uri: uri.toString(), languageId }
        ))
        .then((response: ServerResponseIsSpellCheckEnabled) => response);
    }

    public getConfigurationForDocument(document: vscode.TextDocument): Thenable<GetConfigurationForDocumentResult> {
        const { uri, languageId = '' } = document;

        if (!uri || !languageId) {
            return Promise.resolve({});
        }

        return this.client.onReady().then(() => this.sendRequest(
            methodNames.getConfigurationForDocument,
            { uri: uri.toString(), languageId }
        ));
    }

    public splitTextIntoDictionaryWords(text: string): Thenable<SplitTextIntoWordsResult> {
        return this.client.onReady().then(() => this.sendRequest(
            methodNames.splitTextIntoWords,
            text
        ));
    }

    public notifySettingsChanged() {
        return this.client.onReady().then(() => this.sendNotification('onConfigChange'));
    }

    public registerConfiguration(path: string) {
        return this.client.onReady().then(() => this.sendNotification('registerConfigurationFile', path));
    }

    get diagnostics(): Maybe<vscode.DiagnosticCollection> {
        return (this.client && this.client.diagnostics) || undefined;
    }

    public triggerSettingsRefresh() {
        return this.notifySettingsChanged();
    }

    private sendRequest(method: RequestMethods, param?: any) {
        return this.client.sendRequest(method, param);
    }

    private sendNotification(method: NotifyServerMethods, params?: any): void {
        this.client.sendNotification(method, params);
    }

    public static create(module: string) {
        return vscode.languages.getLanguages().then(langIds => new CSpellClient(module, langIds));
    }

    public isLookBackSupported(): boolean {
        try {
            return /(?<=\s)x/.test(' x');
        } catch (_) {
        }
        return false;
    }

    private calcServerArgs(): string[] {
        const args: string[] = [];
        if (!this.isLookBackSupported()) {
            args.push('--harmony_regexp_lookbehind');
        }
        return args;
    }
}
