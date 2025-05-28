#!/bin/bash

# Define the output Markdown file
OUTPUT_FILE="EXAMPLES.md"

# --- Script Start ---
echo "Generating $OUTPUT_FILE..."

# Overwrite/create the file and add the main header
echo "# Examples of \`frame-msg\` npm package usage" > "$OUTPUT_FILE"
echo "## Background" >> "$OUTPUT_FILE"
echo "Frame is a pair of smart glasses that communicates via Bluetooth Low Energy with a host device, and runs Lua code on its VM. Lua code is sent to Frame in the application startup sequence." >> "$OUTPUT_FILE"
echo "Each example contains a Javascript file and a corresponding Lua file that is copied to Frame on startup using uploadFrameApp() after the required standard Lua libs are uploaded." >> "$OUTPUT_FILE"
echo "The host-side Javascript program and the device-side Lua program pass messages to each other identified by a single-byte message code, so these codes must match exactly for handlers to correctly process messages." >> "$OUTPUT_FILE"
echo "Numerous examples follow that demonstrate many features of the Frame SDK and the corresponding host-side and device-side code." >> "$OUTPUT_FILE"
echo "See: https://docs.brilliant.xyz/frame/frame-sdk/" >> "$OUTPUT_FILE"

# Add a blank line after the main header for better spacing
echo "" >> "$OUTPUT_FILE"

# Find all JavaScript files (e.g., *.js) in the current directory
# The loop will iterate through each found .js file
for js_file in *.js; do
  # Check if the glob actually found any files.
  # If no .js files are present, $js_file would be the literal string "*.js".
  # The -f check ensures we only process actual files.
  if [ -f "$js_file" ]; then
    echo "Processing JavaScript file: $js_file"

    # --- JavaScript File Inclusion ---

    # Derive the title for the JavaScript file:
    # 1. Get the filename without the .js extension (e.g., "my-example")
    base_name_js=$(basename "$js_file" .js)
    # 2. Convert dashes in the basename to spaces for the title (e.g., "my example")
    title_js=$(echo "$base_name_js" | sed 's/-/ /g')

    # Add the Markdown header for the JavaScript file
    echo "## $title_js" >> "$OUTPUT_FILE"

    # Add a comment indicating the start of the JavaScript file content
    echo "// JavaScript file: $js_file" >> "$OUTPUT_FILE"

    # Add the JavaScript code block with language specifier
    echo '```javascript' >> "$OUTPUT_FILE"
    cat "$js_file" >> "$OUTPUT_FILE"
    # Ensure there's a newline after catting the file, then close the code block
    echo "" >> "$OUTPUT_FILE"
    echo '```' >> "$OUTPUT_FILE"

    # Add a comment indicating the end of the JavaScript file content
    echo "" >> "$OUTPUT_FILE"
    # Add a blank line for separation before the Lua file or next JS file
    echo "" >> "$OUTPUT_FILE"

    # --- Lua File Inclusion ---

    # Derive the corresponding Lua filename:
    # Example JS: my-example.js
    # Expected Lua: lua/my_example_frame_app.lua
    # 1. Convert dashes in the JS basename to underscores (e.g., "my_example")
    lua_base_name=$(echo "$base_name_js" | tr '-' '_')
    # 2. Construct the full Lua file path
    lua_file="lua/${lua_base_name}_frame_app.lua"

    # Check if the corresponding Lua file exists
    if [ -f "$lua_file" ]; then
      echo "Found corresponding Lua file: $lua_file"

      # Add a comment indicating the start of the Lua file content
      echo "// Corresponding Lua file: $lua_file" >> "$OUTPUT_FILE"

      # Add the Lua code block with language specifier
      # No separate Markdown title for the Lua file, as it's contextually linked to the JS file
      echo '```lua' >> "$OUTPUT_FILE"
      cat "$lua_file" >> "$OUTPUT_FILE"
      # Ensure there's a newline after catting the file, then close the code block
      echo "" >> "$OUTPUT_FILE"
      echo '```' >> "$OUTPUT_FILE"

      # Add a comment indicating the end of the Lua file content
      echo "" >> "$OUTPUT_FILE"
      # Add a blank line for separation
      echo "" >> "$OUTPUT_FILE"
    else
      # If the Lua file is not found, print a warning to the console
      echo "Warning: Lua file '$lua_file' not found for '$js_file'."
      # Optionally, add a comment to the Markdown file indicating the missing Lua file
      echo "Corresponding Lua file not found: $lua_file" >> "$OUTPUT_FILE"
    fi
  else
    # This case handles when no *.js files are found in the directory.
    # The loop might run once with js_file="*.js" if no files match.
    if [[ "$js_file" == "*.js" ]]; then
        echo "No JavaScript files found in the current directory."
        # Break out of the loop if it's the literal "*.js"
        break
    fi
  fi
done

echo "$OUTPUT_FILE has been generated successfully."
# --- Script End ---
