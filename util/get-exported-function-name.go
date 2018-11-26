package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"strings"
)

// Map returns a new slice containing the results of applying the function f to each ast.Field in the original slice.
func Map(vs []*ast.Field, f func(*ast.Field) string) []string {
	vsm := make([]string, len(vs))
	for i, v := range vs {
		vsm[i] = f(v)
	}
	return vsm
}

// GetParamType return the string representation of the ast.Field.
func GetParamType(field *ast.Field) string {
	var typeNameBuf bytes.Buffer
	err := printer.Fprint(&typeNameBuf, fset, field.Type)
	if err != nil {
		fmt.Printf("failed to get the parameter type \"%s\"\n", err)
		os.Exit(1)
	}
	return typeNameBuf.String()
}

var fset *token.FileSet

func main() {
	if len(os.Args) != 2 {
		// Args should have the program name on `0`
		// and the file name on `1`
		fmt.Println("Wrong number of args; Usage is:\n  ./get-exported-function-name file_name.go")
		os.Exit(1)
	}
	fileName := os.Args[1]
	fset = token.NewFileSet()

	parsed, err := parser.ParseFile(fset, fileName, nil, parser.ParseComments)
	if err != nil {
		fmt.Printf("Could not parse Go file \"%s\"\n", fileName)
		os.Exit(1)
	}

	gotHandler := false
	output := make([]string, 0)
	for _, decl := range parsed.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok {
			// this declaraction is not a function
			// so we're not interested
			continue
		}
		if fn.Name.IsExported() == true {
			// we are looking the signature of the function
			// we only want functions that respect the following signatures
			// XXXX(w http.ResponseWriter, r *http.Request)  => for the Handler
			// We only accept one Handler by file! If more exit with error 1.
			// XXXX(next http.HandlerFunc) http.HandlerFunc  => for the middleware
			switch nbParams := len(fn.Type.Params.List); nbParams {
			case 2:
				// it's maybe the signature of our Handler
				// we analyze the parameters and we chained the types of parameters
				// if the string matches http.ResponseWriter,*http.Request we got our handler
				signature := strings.Join(Map(fn.Type.Params.List, GetParamType), ",")
				if signature == "http.ResponseWriter,*http.Request" {
					if !gotHandler {
						output = append(output, fmt.Sprintf("%s-Handler", fn.Name.Name))
						gotHandler = true
					} else {
						fmt.Printf("Found more than one handler function with signature XXXX(w http.ResponseWriter, r *http.Request){}. \"%s\"\n", fn.Name.Name)
						os.Exit(1)
					}
				}
			case 1:
				// it's maybe the signature of a middleware
				// we analyze the parameters and we get the type.
				// if the string matches http.HandlerFunc we got a middleware
				signature := strings.Join(Map(fn.Type.Params.List, GetParamType), ",")
				if signature == "http.HandlerFunc" {
					output = append(output, fmt.Sprintf("%s-Middleware", fn.Name.Name))
				}
			default:
				// there are more or less params so we're not interested
				continue
			}
		}
	}
	fmt.Println(strings.Join(output, ","))
	os.Exit(0)
}
