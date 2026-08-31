import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4310);
const { app } = createApp();
app.listen(port, () => console.log(`Cartograph API listening on http://localhost:${port}`));
