#!/bin/bash

# -- VARIABLES
SCRIPTS_DIR="${HOME}/.local/scripts"
SRCS_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" && pwd)/src

# -- LOGIC

# Notify begin
printf "\nBEGINNING INSTALLATION\n"

# Check that scripts direrctory exists
#	If not, create it
#	otherwise, link script in such dir
if [ ! -d "${SCRIPTS_DIR}" ]; then
	mkdir -p "${SCRIPTS_DIR}"
else
	ln -s "${SRCS_DIR}/zk-graph-viz.sh" "${SCRIPTS_DIR}/zk-graph-viz" && printf "zk-graph-viz.sh linked in ${SCRIPTS_DIR}\n"
fi

# If scripts directory is not in path, include it
echo ${PATH} | grep ${SCRIPTS_DIR} > /dev/null || \
	export PATH=${PATH}:${SCRIPTS_DIR}

# Notify end
printf "\nINSTALLATION FINISHED\n"
