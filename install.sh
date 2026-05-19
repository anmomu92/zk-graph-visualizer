#!/bin/bash

# -- VARIABLES
SCRIPTS_DIR="${HOME}/.local/scripts"
SRCS_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" && pwd)/src

# -- LOGIC

# Notify begin
printf "\nBEGINNING INSTALLATION\n"

# Check that scripts direrctory exists
#	If not, create it
#	otherwise, link scripts in such dir
if [ ! -d "${SCRIPTS_DIR}" ]; then
	mkdir -p "${SCRIPTS_DIR}"
else
	for script in "${SRCS_DIR}"/*; do
		filename=$(basename "$script")
		name="${filename%.sh}"
		ln -s "${SRCS_DIR}/${filename}" "${SCRIPTS_DIR}/${name}" && \
			printf "zk-graph-viz.sh linked in ${SCRIPTS_DIR}\n"
	done
fi

# If scripts directory is not in path, include it
echo ${PATH} | grep ${SCRIPTS_DIR} > /dev/null || \
	export PATH=${PATH}:${SCRIPTS_DIR}

# Notify end
printf "\nINSTALLATION FINISHED\n"
