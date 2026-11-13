package com.lwoptimizer.ui.api;

import com.lwoptimizer.ui.api.dto.ErrorDto;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.NoSuchElementException;

/** Turns the optimizer's own error messages into HTTP answers a client can show as they are. */
@RestControllerAdvice
public class ApiErrors {

    /** An invalid setting, constraint or plan: the message says which and why. */
    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorDto invalid(IllegalArgumentException e) {
        return new ErrorDto(e.getMessage());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorDto unreadable(HttpMessageNotReadableException e) {
        return new ErrorDto("The request body is not valid JSON for this operation: " + e.getMostSpecificCause().getMessage());
    }

    @ExceptionHandler(NoSuchElementException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorDto notFound(NoSuchElementException e) {
        return new ErrorDto(e.getMessage());
    }

    /** The problem could not be prepared, typically because an outside service did not answer. */
    @ExceptionHandler(IllegalStateException.class)
    @ResponseStatus(HttpStatus.BAD_GATEWAY)
    public ErrorDto unavailable(IllegalStateException e) {
        return new ErrorDto(e.getMessage());
    }
}
