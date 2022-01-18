import * as vscode from "vscode";

export function getWebviewOptions(
  extensionUri: vscode.Uri
): vscode.WebviewOptions {
  return {
    // Enable javascript in the webview
    enableScripts: true,

    // And restrict the webview to only loading content from our extension's `media` directory.
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
  };
}
/** TODO:
 *
 * - onDidChangeTextDocument  >  await client.sendRequest("renderTemplate", { template: text });
 * - debounce requests
 * - fix the side-by-side column display
 * - tweak the icon?
 * - add a loader when request is in progress - https://code.visualstudio.com/api/references/vscode-api workspace.busy
 * - Display listening events list?
 * - Add links to https://jinja.palletsprojects.com/en/latest/templates/ and https://www.home-assistant.io/docs/configuration/templating/
 * - Add a refresh button
 */

/**
 * Manages jinja2 template preview webview panels
 */
export class TemplatePreviewPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: TemplatePreviewPanel | undefined;

  public static readonly viewType = "templatePreview";

  private readonly panel: vscode.WebviewPanel;

  private template: string;

  private readonly extensionUri: vscode.Uri;

  private disposables: vscode.Disposable[] = [];

  public static createOrShow(sourceUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const title = vscode.window.activeTextEditor.document.fileName;

    // If we already have a panel, show it.
    if (TemplatePreviewPanel.currentPanel) {
      TemplatePreviewPanel.currentPanel.panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      TemplatePreviewPanel.viewType,
      `${title} - Home Assistant Template Preview`,
      vscode.ViewColumn.Two,
      getWebviewOptions(sourceUri)
    );

    TemplatePreviewPanel.currentPanel = new TemplatePreviewPanel(
      panel,
      sourceUri
    );
  }

  public static revive(panel: vscode.WebviewPanel, sourceUri: vscode.Uri) {
    TemplatePreviewPanel.currentPanel = new TemplatePreviewPanel(
      panel,
      sourceUri
    );
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set the webview's initial html content
    this.update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Update the content based on view changes
    this.panel.onDidChangeViewState(
      (e) => {
        if (this.panel.visible) {
          this.update();
        }
      },
      null,
      this.disposables
    );

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "alert":
            // vscode.window.showErrorMessage(message.text);
            return;
          case "update":
            this.template = message.template;
            this.update();
            return;
        }
      },
      null,
      this.disposables
    );
  }

  public updateTemplate(template: string): void {
    // Send a message to the webview webview.
    // You can send any JSON serializable data.
    this.panel.webview.postMessage({ command: "update", template });
  }

  public dispose(): void {
    TemplatePreviewPanel.currentPanel = undefined;

    // Clean up our resources
    this.panel.dispose();

    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  // TODO: https://stackoverflow.com/a/53293685
  // TODO: Ensure it matches home-assistant-jinja file
  private update(): void {
    const webview = this.panel.webview;

    this.updateRenderedTemplate(webview, this.template);
  }

  private updateRenderedTemplate(webview: vscode.Webview, template: string) {
    this.panel.webview.html = this.getHtmlForWebview(webview, template);
  }

  private getHtmlForWebview(webview: vscode.Webview, template: string) {
    // Local path to main script run in the webview
    const scriptPathOnDisk = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "main.js"
    );

    // And the uri we use to load this script in the webview
    const scriptUri = scriptPathOnDisk.with({ scheme: "vscode-resource" });

    // Local path to css styles
    const styleResetPath = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "reset.css"
    );
    const stylesPathMainPath = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "vscode.css"
    );

    // Uri to load styles into webview
    const stylesResetUri = webview.asWebviewUri(styleResetPath);
    const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${stylesResetUri}" rel="stylesheet">
				<link href="${stylesMainUri}" rel="stylesheet">

				<title>Home Assistant Template Preview</title>
			</head>
			<body>
        <pre>
        ${template}
        </pre>
				<h1 id="lines-of-code-counter">0</h1>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
