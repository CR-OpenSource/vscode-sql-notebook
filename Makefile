
.PHONY: sqls sqls/linux/amd64

sqls:
	cd sqls && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ../bin/sqls-linux-amd64 ./main.go
	cd sqls && GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -o ../bin/sqls-darwin-amd64 ./main.go
	cd sqls && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o ../bin/sqls-linux-arm ./main.go
	cd sqls && GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o ../bin/sqls-darwin-arm ./main.go
	cd sqls && GOOS=windows GOARCH=386 CGO_ENABLED=0 go build -o ../bin/sqls-windows-386 ./main.go
