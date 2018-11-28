#!/usr/bin/env bash

mkdir -p bin
cd util
if [ "{$OS}" == "windowsnt" ]; then
    GOOS=windows GOARCH=amd64  go build get-exported-function-name.go
elif [ "{$OS}" == "darwin" ]; then
    GOOS=darwin GOARCH=amd64 go build get-exported-function-name.go
else
    GOOS=linux GOARCH=amd64 go build get-exported-function-name.go
if
mv get-exported-function-name ../bin/