#!/bin/bash

# Variables
WWW_DIR="$( dirname "$( dirname -- "$( readlink -f -- "${BASH_SOURCE[0]}" )" )" )/www"
DATA_DIR="${WWW_DIR}/data"

# create data directory
mkdir -p ${DATA_DIR}

BROWSER="firefox --private-window"

# Generate JSON files
zk graph -f json > "${DATA_DIR}/graph.json"
zk list -f json > "${DATA_DIR}/notes.json"

# Run server
if [[ $( pgrep -f "python3 -m http.server" ) || $( pgrep -f "python3 -m ${WWW_DIR}" ) ]]; then
	printf "\nZK-GRAPH-VISUALIZER is already running. Go to 0.0.0.0:8000 in your browser and push the refresh button in the top bar\n\n"
else
	python3 -m http.server -d ${WWW_DIR} &
fi

# Open the browser
# ${BROWSER} "http://127.0.0.1:8000/"
