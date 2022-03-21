import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

let etherpad = require('etherpad-lite-client');
import { stringifyYaml } from 'obsidian';

let TurndownService = require('turndown')

TurndownService.prototype.escape = (text)=>text;

function makeid(length) {
  let result           = '';
  let characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for ( let i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * 
charactersLength));
 }
 return result;
}

let td = new TurndownService()
  .addRule('strikethrough', {
    filter: ['s'],
    replacement: function (content) {
      return '~~' + content + '~~'
    }
  })
  .addRule('underline', {
    filter: ['u'],
    replacement: function (content) {
      return '==' + content + '==';
    }
  })
  .addRule('a', {
    filter: ['a'],
    replacement: function(content, node, options) {
      return node.getAttribute("href")
    }
  })

interface EtherpadSettings {
  host: string;
  port: int;
  apikey: string;
  random_pad_id: bool;
}

const DEFAULT_SETTINGS: EtherpadSettings = {
  host: 'localhost',
  port: 9001,
  apikey: "",
  random_pad_id: true
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
    //const statusBarItemEl = this.addStatusBarItem();
    //statusBarItemEl.setText('Status Bar Text');

    this.registerEvent(
      this.app.workspace.on('file-open', async (note)=>{
        this.replace_note_from_etherpad(note);
      })
    );

    // This adds an editor command that can perform some operation on the current editor instance
    this.addCommand({
      id: 'etherpad-create-pad',
      name: 'Convert current document to Etherpad',
      editorCallback: async (editor: Editor, view: MarkdownView) => {

        const note = view.file;

        if (!note.name)
          return;

        let note_text = editor.getValue();
        let note_text_without_frontmatter = await this.get_text_without_frontmatter(note_text, note);

        let pad_id = this.settings.random_pad_id ? makeid(12) : note.basename;

        this.etherpad.createPad({
          padID: pad_id,
          text: note_text_without_frontmatter
        }, (error, data)=>{
          if (error) {
            new Notice(`Error creating pad ${pad_id}: ${error.message}`);
          }
          else {
            this.update_frontmatter(note_text, note, {etherpad_id: pad_id});
          }
        })
      }
    });

    this.addCommand({
      id: 'etherpad-get-pad',
      name: 'Replace note content from Etherpad',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const note = view.file;
        this.replace_note_from_etherpad(note);
      }
    });

    this.addCommand({
      id: 'etherpad-visit-pad',
      name: 'Visit note in Etherpad in system browser',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        let note = view.file;
        if (!note.name)
          return;

        let frontmatter = this.get_frontmatter(note);
        if (frontmatter?.etherpad_id) {
          let url = this.get_url_for_pad_id(frontmatter.etherpad_id);
          window.open(url);
        }
      }
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new EtherpadSettingTab(this.app, this));

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

  async get_text_without_frontmatter(note_text, note) {
    //let note_text = await this.app.vault.read(note);
    let fmc = app.metadataCache.getFileCache(note)?.frontmatter;
    if (!fmc) {
      return note_text;
    }
    let end = fmc.position.end.line + 1 // account for ending ---
    return note_text.split("\n").slice(end).join("\n");
  }

  async update_frontmatter(note_text, note, d) {
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
    let frontmatter_text = `---\n${stringifyYaml(updated_frontmatter)}---\n`;
    //let note_text = await this.get_text_without_frontmatter(note);
    this.app.vault.modify(note, frontmatter_text + note_text);
  }

  get_url_for_pad_id(pad_id) {
    pad_id = pad_id.replace(" ", "_");
    return `http://${this.settings.host}:${this.settings.port}/p/${pad_id}`
  }

  async replace_note_from_etherpad(note) {
    if (note == null) return;
    let frontmatter = this.get_frontmatter(note);
    if (!frontmatter) return;
    if (!frontmatter.etherpad_id) return;
    this.etherpad.getHTML({padID: frontmatter.etherpad_id}, (err, data)=>{
      if (err) {
        console.log("err", err);
        new Notice("error: " + err);
      } else {
        delete frontmatter.position;
        let now = new Date();
        frontmatter.etherpad_get_at = now.toLocaleString();
        let frontmatter_text = `---\n${stringifyYaml(frontmatter)}---\n`;
        let note_html = data.html;

        let note_text = td.turndown(note_html)
        this.app.vault.modify(note, frontmatter_text + note_text);
        let url = this.get_url_for_pad_id(frontmatter.etherpad_id);
        new Notice(`Note was reloaded from ${url}.\nLocal edits will be discarded!`);
      }
    });
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
        .setValue(this.plugin.settings.port.toString())
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

    new Setting(containerEl)
      .setName('Random pad ID')
      .setDesc('Use a random pad id, or current file name')
      .addToggle(b => b
        .setValue(this.plugin.settings.random_pad_id)
        .onChange(async (value) => {
          this.plugin.settings.random_pad_id = value;
          await this.plugin.saveSettings();
        }));
  }
}
