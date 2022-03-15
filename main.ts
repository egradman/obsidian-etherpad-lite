import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

let etherpad = require('etherpad-lite-client');
import YAML from 'yaml'

// Remember to rename these classes and interfaces!

interface EtherpadSettings {
  host: string;
  port: int;
  apikey: string;
}

const DEFAULT_SETTINGS: EtherpadSettings = {
  host: 'localhost',
  port: 9001,
  apikey: ""
}


export default class Etherpad extends Plugin {
  settings: EtherpadSettings;

  get etherpad() {
    return etherpad.connect({
      apikey: this.settings.apikey,
      host: this.settings.host,
      port: this.settings.port
    })
  }

  async onload() {
    await this.loadSettings();

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText('Status Bar Text');

    this.app.workspace.on('file-open', async (note)=>{
      this.replace_note_from_etherpad(note);
    });

    // This adds an editor command that can perform some operation on the current editor instance
    this.addCommand({
      id: 'etherpad-create-pad',
      name: 'Convert current document to Etherpad',
      editorCallback: async (editor: Editor, view: MarkdownView) => {

        const note = this.app.workspace.getActiveFile();

        if (!note.name)
          return;

        let note_text = await this.get_text_without_frontmatter(note);
        let pad_id = note.basename;

        this.etherpad.createPad({
          padID: pad_id,
          text: note_text
        }, (error, data)=>{
          if (error) {
            new Notice(`Error creating pad ${pad_id}: ${error.message}`);
          }
          else {
            this.update_frontmatter(note, {etherpad_id: pad_id});
          }
        })
      }
    });

    this.addCommand({
      id: 'etherpad-get-pad',
      name: 'Replace note content from Etherpad',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const note = this.app.workspace.getActiveFile(); // Currently Open Note
        this.replace_note_from_etherpad(note);
      }
    });

    this.addCommand({
      id: 'etherpad-visit-pad',
      name: 'Visit note in Etherpad in system browser',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const note = this.app.workspace.getActiveFile(); // Currently Open Note
        if (!note.name)
          return;

        let frontmatter = this.get_frontmatter(note);
        if (frontmatter?.etherpad_id) {
          let url = this.get_url_for_pad_id(frontmatter.etherpad_id);
          require('electron').shell.openExternal(url);
        }
      }
    });

    // This adds a complex command that can check whether the current state of the app allows execution of the command
    //this.addCommand({
    //  id: 'open-sample-modal-complex',
    //  name: 'Open sample modal (complex)',
    //  checkCallback: (checking: boolean) => {
    //    // Conditions to check
    //    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    //    if (markdownView) {
    //      // If checking is true, we're simply "checking" if the command can be run.
    //      // If checking is false, then we want to actually perform the operation.
    //      if (!checking) {
    //        new EtherpadModal(this.app).open();
    //      }

    //      // This command will only show up in Command Palette when the check function returns true
    //      return true;
    //    }
    //  }
    //});

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new EtherpadSettingTab(this.app, this));

    // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
    // Using this function will automatically remove the event listener when this plugin is disabled.
    //this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
    //  console.log('click', evt);
    //});

    // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
    //this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
  }

  onunload() {

  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  get_frontmatter(note) {
    // return a copy
    return {...this.app.metadataCache.getFileCache(note)?.frontmatter};
  }

  async get_text_without_frontmatter(note) {
    let note_text = await this.app.vault.read(note);
    let fmc = app.metadataCache.getFileCache(note)?.frontmatter;
    if (!fmc) {
      return note_text;
    }
    let end = fmc.position.end.line + 1 // account for ending ---
    return note_text.split("\n").slice(end).join("\n");
  }

  async update_frontmatter(note, d) {
    let frontmatter = this.get_frontmatter(note);
    let updated_frontmatter;
    if (!frontmatter) {
      // create new frontmatter
      updated_frontmatter = d;
    } else {
      updated_frontmatter = {
        ...frontmatter,
        ...d
      };
    }
    delete updated_frontmatter.position;
    let frontmatter_text = `---\n${YAML.stringify(updated_frontmatter)}---\n`;
    let note_text = await this.get_text_without_frontmatter(note);
    this.app.vault.modify(note, frontmatter_text + note_text);
  }

  get_url_for_pad_id(pad_id) {
    pad_id = pad_id.replace(" ", "_");
    return `http://${this.settings.host}:${this.settings.port}/p/${pad_id}`
  }

  async replace_note_from_etherpad(note) {
    let frontmatter = this.get_frontmatter(note);
    if (!frontmatter) return;
    if (!frontmatter.etherpad_id) return;
    this.etherpad.getText({padID: frontmatter.etherpad_id}, (err, data)=>{
      if (err) {
        console.log("err", err);
      } else {
        delete frontmatter.position;
        let now = new Date();
        frontmatter.etherpad_get_at = now.toLocaleString();
        let frontmatter_text = `---\n${YAML.stringify(frontmatter)}---\n`;
        let note_text = data.text;
        this.app.vault.modify(note, frontmatter_text + note_text);
        let url = this.get_url_for_pad_id(frontmatter.etherpad_id);
        new Notice(`Note was reloaded from ${url}.\nLocal edits will be discarded!`);
      }
    });
  }
}

class EtherpadModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    contentEl.setText('Woah!');
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

class EtherpadSettingTab extends PluginSettingTab {
  plugin: Etherpad;

  constructor(app: App, plugin: Etherpad) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;

    containerEl.empty();

    containerEl.createEl('h2', {text: 'Etherpad Settings'});

    new Setting(containerEl)
      .setName('Server host')
      .setDesc('Server host')
      .addText(text => text
        .setPlaceholder('localhost')
        .setValue(this.plugin.settings.host)
        .onChange(async (value) => {
          this.plugin.settings.host = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Server port')
      .setDesc('Server port')
      .addText(text => text
        .setPlaceholder('9001')
        .setValue(this.plugin.settings.port)
        .onChange(async (value) => {
          this.plugin.settings.port = parseInt(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API key')
      .setDesc('API key')
      .addText(text => text
        .setPlaceholder('')
        .setValue(this.plugin.settings.apikey)
        .onChange(async (value) => {
          this.plugin.settings.apikey = value;
          await this.plugin.saveSettings();
        }));
  }
}
