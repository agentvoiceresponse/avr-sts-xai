const fs = require("fs");
const path = require("path");

/**
 * Loads all available tools from both avr_tools and tools directories
 * @returns {Array} List of all available tools
 */
function loadTools() {
  const avrToolsDir = path.join(__dirname, "avr_tools");
  const toolsDir = path.join(__dirname, "tools");

  let allTools = [];

  const loadToolsFromDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return [];

    return fs.readdirSync(dirPath)
      .filter((file) => file.endsWith(".js"))
      .map((file) => {
        const tool = require(path.join(dirPath, file));
        return {
          type: "function",
          name: tool.name,
          description: tool.description || "",
          parameters: tool.input_schema || {},
        };
      });
  };

  allTools = [
    ...loadToolsFromDir(avrToolsDir),
    ...loadToolsFromDir(toolsDir),
  ];

  if (allTools.length === 0) {
    console.warn(`No tools found in ${avrToolsDir} or ${toolsDir}`);
  }

  return allTools;
}

/**
 * Gets the handler for a specific tool
 * @param {string} name - Name of the tool
 * @returns {Function} Tool handler
 */
function getToolHandler(name) {
  const possiblePaths = [
    path.join(__dirname, "avr_tools", `${name}.js`),
    path.join(__dirname, "tools", `${name}.js`),
  ];

  const toolPath = possiblePaths.find((p) => fs.existsSync(p));

  if (!toolPath) {
    throw new Error(`Tool "${name}" not found in any available directory`);
  }

  const tool = require(toolPath);
  return tool.handler;
}

module.exports = { loadTools, getToolHandler };
