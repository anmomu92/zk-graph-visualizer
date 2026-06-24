#!/bin/bash

# Variables
WWW_DIR="$( dirname "$( dirname -- "$( readlink -f -- "${BASH_SOURCE[0]}" )" )" )/www"
DATA_DIR="${WWW_DIR}/data"

# create data directory
if [ ! -d "${DATA_DIR}" ]; then
    mkdir -p "${DATA_DIR}"
fi

# Run server
if [[ $( pgrep -f "python3 -m http.server" ) || $( pgrep -f "python3 -m ${WWW_DIR}" ) ]]; then
	printf "\nZK-GRAPH-VISUALIZER is already running. Killing the process.\n\n"
else
	exec python3 -m http.server -d ${WWW_DIR}
fi

# Generate JSON files
zk graph -f json > "${DATA_DIR}/graph.json"
zk list -f json > "${DATA_DIR}/notes.json"

