#!/bin/bash
set -e
SCRIPT_HOME="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

pushd "${SCRIPT_HOME}" > /dev/null
    docker compose down
popd > /dev/null
