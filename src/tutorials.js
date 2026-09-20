/* src/tutorials.js -- the Help page's lessons. Each has written steps and a
   `video` slot: set it to a hosted MP4 or a YouTube/Loom embed URL and the
   card plays it; leave it null and the card shows the steps with a "video
   coming" mark. Nothing else needs to change to add a recording. */
export const TUTORIALS = [
  { id: "start", title: "Your first tag in three minutes", minutes: 3, for: "everyone", video: null,
    blurb: "Add a store, pick a material, ask for a tag, print it.",
    steps: ["Stores -> Add a store (or upload your account list).", "Request a tag -> pick the store, the tag type, the item and the price.", "Queue -> tick the request, choose the sheet in the printer, Make a print batch.", "Print batches -> Print sheet -> print at 100% with margins set to None.", "Mark printed. The rep sees it flip to Printed on their phone."] },
  { id: "chain", title: "Set up a chain's own tag", minutes: 5, for: "admins", video: null,
    blurb: "Some chains hand you their artwork. Upload it once and every store of that chain prints in it.",
    steps: ["Chain styles -> next to the chain, + Template.", "Upload the PNG, JPG or one-page PDF the chain sent. A PDF fills in the printed size.", "Drag the price, item and size fields onto the artwork. The preview underneath is exactly what prints.", "Save. Every request for that chain's stores now renders on the template.", "No artwork? + Layout builds a look from colours, a font and a logo instead."] },
  { id: "import", title: "Import a chain's price book", minutes: 4, for: "admins", video: null,
    blurb: "A spreadsheet with hundreds of prices becomes hundreds of tags without typing one.",
    steps: ["Queue -> Import price book. Download the template if you want to see the shape, but any sheet with Brand, Package and Price columns works, header on any row.", "Choose who the tags are for: one store, every store of a chain, or the sheet's own Store column.", "Preview. Every row reads OK, Adjusted (with what changed) or Error (with why). Nothing is written yet.", "Import. The rows land in the queue as ordinary requests, marked Imported."] },
  { id: "rules", title: "Rules: colour and copy that follow the price", minutes: 4, for: "admins", video: null,
    blurb: "A 2-for price in a different colour. 'Reg. $x' under every promo. The style decides, not the rep.",
    steps: ["Chain styles -> Edit a layout style -> Rules.", "Start from a preset (Reg. line, Single retail, Colour by tier) or add your own: when a field meets a condition, set colours or a note.", "Rules run top to bottom; a later rule wins. The sample tag on the right updates as you type.", "Save. Every tag in that style, from the rep's preview to the print sheet, applies the same rules."] },
  { id: "brands", title: "Brand logos on tags", minutes: 3, for: "admins", video: null,
    blurb: "Recognize the brands in your item list, find their logos, approve what looks right.",
    steps: ["Catalog -> upload your item list (Item #, Name, Brand, Package).", "Brand logos -> 1 Recognize brands. Abbreviations like MICH ULT become Michelob Ultra.", "2 Find logos. tagup searches the web and, with an AI key on the server, checks each match.", "3 Approve. Nothing prints until a person approves it. Upload your own file for any brand -- that copy is yours alone."] },
  { id: "team", title: "Invite the team", minutes: 2, for: "admins", video: null,
    blurb: "Reps request. Managers work their team's queue. Admins set up styles and stores.",
    steps: ["Team -> Invite. Enter an email and a role.", "Rep: asks for tags for their stores, sees their own requests. Manager: works the queue and prints, for their team. Admin: everything, including styles, materials, stores and the item list.", "Optional: make teams and put stores and people on them -- a manager then sees only their team's work.", "They get an email with a link; accepting it sets their password and lands them in your workspace."] },
];
